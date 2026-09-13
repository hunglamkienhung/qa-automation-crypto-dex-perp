'use strict';

/**
 * The live DEX trading screen, read by LABEL.
 *
 * The page is a React app with hashed class names and no test IDs, so the
 * reliable anchor is the text a trader reads: the header runs
 *
 *   <PAIR>/USD | [POOL] | $ price | change% | 24H VOLUME | $ vol |
 *   OPEN INTEREST (L%/S%) | $ long | / | $ short | NET RATE / 1H | rate | / | rate
 *
 * Everything below extracts from that sequence of lines, so a redesign that
 * keeps the labels keeps the tests, and a redesign that drops a label fails as
 * ScreenNotReady rather than reading a neighbouring number as the wrong thing.
 *
 * Readiness is by LABEL WITH A NUMBER, never by time: the app takes 10-25 s to
 * fill in, and a fixed sleep either wastes it or reads a blank. If the labelled
 * number never arrives the page raises ScreenNotReady, which the step layer
 * turns into Blocked -- a screen that did not load has not shown a wrong price.
 *
 * Market selection goes through the pair dropdown; the URL alone does not
 * switch markets (measured).
 */

const URL = 'https://app.gmx.io/#/trade';

class ScreenNotReady extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScreenNotReady';
  }
}

/** "$ 6.0m" -> { value: 6000000, unit: 100000 }; "$ 170.4k" -> { 170400, 100 }; "$ 2,522.99" -> { 2522.99, 0.01 } */
function parseMoney(text) {
  const m = String(text).replace(/[$,\s]/g, '').match(/^([-+]?\d+(?:\.\d+)?)([kmb])?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  const decimals = (m[1].split('.')[1] || '').length;
  // the resolution the screen rounded to: one unit in the last shown digit
  const unit = mult / 10 ** decimals;
  return { value: n * mult, unit };
}

/** "- 0.0010%" -> -0.000010 (a fraction); "+ 0.0005%" -> 0.000005 */
function parsePercent(text) {
  const m = String(text).replace(/\s/g, '').match(/^([-+])?(\d+(?:\.\d+)?)%$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * Number(m[2]) / 100;
}

/** "(53%/47%)" -> { long: 53, short: 47 } */
function parseSplit(text) {
  const m = String(text).match(/\((\d+)%\/(\d+)%\)/);
  return m ? { long: Number(m[1]), short: Number(m[2]) } : null;
}

async function bodyLines(page) {
  return page.evaluate(() =>
    document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean));
}

class TradingPage {
  constructor(page) {
    this.page = page;
  }

  async open() {
    try {
      await this.page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (err) {
      throw new ScreenNotReady('could not open ' + URL + ' -- ' + err.message.split('\n')[0]);
    }
  }

  /**
   * Choose a market through the pair dropdown, then wait for its header.
   *
   * The app re-renders the header while prices stream in, so a click can land
   * on a node that was just replaced. Three attempts; any interaction failure
   * is ScreenNotReady, because a dropdown that would not open has not shown a
   * wrong number.
   */
  async selectMarket(pair, attempts = 3) {
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.waitForHeader();
        const current = await this.readHeader();
        if (current.pair === pair) return;

        const opener = this.page.getByText(new RegExp('^' + current.pair.replace('/', '\\/') + '$')).first();
        await opener.click({ timeout: 15_000 });
        const option = this.page.getByText(new RegExp('^' + pair.replace('/', '\\/') + '$')).first();
        await option.click({ timeout: 15_000 });
        await this.waitForHeader(pair);
        return;
      } catch (err) {
        if (err instanceof ScreenNotReady) throw err;
        lastErr = err;
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(1_500);
      }
    }
    throw new ScreenNotReady('could not select market ' + pair + ' after ' + attempts +
      ' attempts -- ' + String(lastErr && lastErr.message).split('\n')[0]);
  }

  /** Wait until the header shows a number after 24H VOLUME (and the wanted pair, if given). */
  async waitForHeader(pair = null, timeoutMs = 60_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const lines = await bodyLines(this.page);
      const i = lines.findIndex((l) => /^24H VOLUME$/i.test(l));
      const pairLine = lines.slice(0, i > 0 ? i : 0).reverse().find((l) => /\/USD$/.test(l));
      if (i > 0 && /\d/.test(lines[i + 1] || '') && (!pair || pairLine === pair)) return;
      await this.page.waitForTimeout(1_000);
    }
    throw new ScreenNotReady('the trading header never showed a 24H VOLUME figure' +
      (pair ? ' for ' + pair : '') + ' within ' + timeoutMs / 1000 + 's');
  }

  /**
   * Everything in the header, parsed. Numbers keep the resolution the screen
   * rounded to (`unit`), so a comparison can say "within what was displayed".
   */
  async readHeader() {
    const lines = await bodyLines(this.page);
    const iVol = lines.findIndex((l) => /^24H VOLUME$/i.test(l));
    if (iVol < 0) throw new ScreenNotReady('no 24H VOLUME label on the page');

    const before = lines.slice(Math.max(0, iVol - 6), iVol);
    const pair = [...before].reverse().find((l) => /\/USD$/.test(l)) || null;
    const pool = before.find((l) => /^\[.+\]$/.test(l)) || null;
    const priceText = before.find((l) => /^\$\s?[\d,]+(\.\d+)?$/.test(l)) || null;
    const changeText = before.find((l) => /^[-+]?\d+(\.\d+)?%$/.test(l)) || null;

    const iOi = lines.findIndex((l, k) => k > iVol && /^OPEN INTEREST/i.test(l));
    const iRate = lines.findIndex((l, k) => k > iVol && /^NET RATE/i.test(l));
    if (iOi < 0 || iRate < 0) throw new ScreenNotReady('header is missing OPEN INTEREST or NET RATE');

    // "OPEN INTEREST (50%/50%)", "$ 6.0m", "/", "$ 6.0m"
    const oiLong = parseMoney(lines[iOi + 1]);
    const oiShort = parseMoney(lines[iOi + 3]);
    // "NET RATE / 1H", "- 0.0010%", "/", "+ 0.0005%"
    const rateLong = parsePercent(lines[iRate + 1]);
    const rateShort = parsePercent(lines[iRate + 3]);

    return {
      pair,
      pool,
      price: priceText ? parseMoney(priceText) : null,
      change: changeText ? parsePercent(changeText) : null,
      volume24h: parseMoney(lines[iVol + 1]),
      oiSplit: parseSplit(lines[iOi]),
      oiLong,
      oiShort,
      netRateLong: rateLong,
      netRateShort: rateShort,
      raw: lines.slice(iVol - 4, iRate + 4),
    };
  }
}

module.exports = { TradingPage, ScreenNotReady, parseMoney, parsePercent, parseSplit, URL };
