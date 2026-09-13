# qa-automation-crypto-perp

Kiểm thử tự động cho một miền hợp đồng phái sinh (perpetuals) crypto, dựng như
một hệ thống chạy được chứ không phải slide. Một miền sàn phái sinh được test ở
**đủ mọi tầng nó có** — contract Solidity, cơ sở dữ liệu indexer, REST API, một
bot rủi ro, và màn hình giao dịch — bởi **hai stack độc lập** (Node dùng
Cucumber, Python dùng pytest-bdd) cùng đọc **một** bộ Gherkin dùng chung và phải
cho **cùng một kết quả ở từng case**.

Không cần tài khoản, không cần key, không dịch vụ trả phí. Clone về là chạy.

[English](README.md) · [Kiến trúc](docs/ARCHITECTURE.md) ·
[Chấm điểm](docs/GRADING.md) · [Gherkin](docs/GHERKIN.md) · [Kịch bản demo](docs/DEMO.md)

## Hai hệ thống được test

**GMX (chỉ đọc)** — một protocol perpetuals thật trên Arbitrum. Đọc theo ba
đường và đối chiếu với chính nó: v1 Vault và v2 markets qua RPC công khai
(`be/contract`), API giá và market công khai (`be/api`), và màn hình giao dịch
(`fe/ui`). Mỗi phép đọc là một bất biến — reserved không vượt pool, spread
oracle đúng thứ tự, open interest khớp giữa token và USD — nên lệch giữa ba góc
nhìn là một phát hiện, không phải chuyện quan điểm.

**PerpDEX (đọc + ghi)** — một sàn phái sinh tự viết bằng Solidity
(`contracts/`), deploy lên anvil local, và **mini-api** (`services/mini-api`),
một indexer tự viết biến event thành SQLite rồi phục vụ tầng REST trên store.
Đây là nơi có đường **ghi**: đặt và khớp lệnh, funding, thanh lý, ADL, admin —
và là nơi tầng DB, API, bot, cùng các bất biến khó được kiểm một cách tất định.

## Tầng và số case

**301 case**, mỗi case một ID bất biến, chạy ở **cả hai** stack và đối chiếu
từng case.

| Tầng | Đối tượng | Số case | Ở đâu |
|---|---|---|---|
| Contract | PerpDEX trên anvil (JSON-RPC, cả hai stack) | 121 | `be/contract`, `contracts/` |
| Contract | GMX v1 Vault + v2 markets trên Arbitrum | 25 | `be/contract` |
| DB | SQLite của mini-api, đọc trực tiếp | 26 | `be/db` |
| API | REST mini-api trên SQLite đó | 40 | `be/api` |
| API | API giá/market công khai của GMX | 43 | `be/api` |
| Bot | cổng rủi ro (thuần) + thao tác trên PerpDEX | 35 | `be/bot` |
| FE | màn hình giao dịch GMX (Playwright) | 11 | `fe/ui` |
| | **Tổng** | **301** | |

## Hai ý đáng một phút

**Một bộ Gherkin, hai stack, một kết quả.** `features/*.feature` dùng chung.
`node/` chạy bằng Cucumber; `python/` chạy chính các file đó bằng pytest-bdd.
Lệch kết quả ở một case tự nó là một phát hiện — logic chấm điểm đang bị hiểu
khác nhau ở hai nơi — và build đỏ vì nó.

**Failed > Blocked > Passed, và mất nguồn không bao giờ là Failed.** Một case
chỉ Failed khi một mệnh đề quan sát được và sai. Khi nguồn ngoài (GMX, một
service đang tắt) không tới được thì case là **Blocked**, không phải Failed —
nên mạng chập chờn không bao giờ giả dạng thành protocol hỏng. Cổng CI kiểm
*hình dạng* lượt chạy so với `fixtures/expected-results.json`: đỏ cả khi Passed
hoá Failed (hồi quy) lẫn khi Failed hoá Passed (phép kiểm ngừng kiểm).

## Chạy trong 30 giây

Thứ nhanh nhất chứng minh bộ máy, không cần gì bên ngoài:

```bash
cd core/node && node --test "selftest/*.test.js"
cd ../python && pip install -e . && python -m pytest selftest -q
```

## Chạy cả bộ

Mỗi lệnh dưới đây đúng bằng thứ CI chạy (`scripts/*.sh`), nên chạy tay cũng được.

```bash
bash scripts/run-be.sh node      # hoặc: python
bash scripts/run-fe.sh node      # cài sẵn chromium
bash scripts/gate.sh node        # cả bộ, rồi kiểm hình dạng lượt chạy
cd contracts && forge test       # chỉ contract, với Foundry
```

Cần: Node ≥ 22.13 (cho `node:sqlite`), Python ≥ 3.11, và — cho tầng contract —
[Foundry](https://book.getfoundry.sh/). Script FE tự cài trình duyệt. Có sẵn
devcontainer trong [.devcontainer/](.devcontainer/devcontainer.json).
