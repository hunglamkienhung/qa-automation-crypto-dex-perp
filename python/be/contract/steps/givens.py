"""Givens of the on-chain tier, shared with the FE feature (see be/api/steps/givens.py)."""

from __future__ import annotations

from pytest_bdd import given, parsers

from be.contract.chain import gmx
from be.contract.chain.ethcall import ChainUnreachable

UNREACHABLE = (ChainUnreachable,)


@given("the RPC is pointed at the expected chain")
def rpc_on_expected_chain(qa):
    def fetch():
        qa.evidence("chainId", gmx.verify_chain())
        qa.evidence("vault", gmx.VAULT)

    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the protocol publishes the "{symbol}" market state'))
def fetch_market_state(qa, symbol):
    def fetch():
        qa.chain = gmx.market_state(symbol)
        qa.evidence("symbol", qa.chain["symbol"])
        qa.evidence("poolAmount", str(qa.chain["poolAmount"]))
        qa.evidence("reservedAmount", str(qa.chain["reservedAmount"]))
        qa.evidence("oraclePriceUsd", round(qa.chain["minPriceUsd"], 2))

    qa.fetch_or_block(UNREACHABLE, fetch)


@given(parsers.parse('the protocol publishes the "{symbol}" funding state'))
def fetch_funding_state(qa, symbol):
    def fetch():
        qa.funding = gmx.funding_state(symbol)
        qa.evidence("lastFundingTime", str(qa.funding["lastFundingTime"]))
        qa.evidence("fundingIntervalSeconds", str(qa.funding["fundingInterval"]))

    qa.fetch_or_block(UNREACHABLE, fetch)


