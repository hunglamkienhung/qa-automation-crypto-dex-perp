// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title Holds every account's USDC and the ledger of who owns how much.
/// @notice The vault does token movement and bookkeeping and nothing else. It
///         does not know what a position is. Whether a withdrawal is SAFE is
///         the exchange's decision, so the exchange is the only caller allowed
///         to move a balance -- a user reaches the vault only through it.
///
///         Balances are signed: a liquidation that cannot be covered leaves an
///         account below zero. That negative number is real information (bad
///         debt) and must not be clamped away; the insurance fund reads it to
///         know what to cover.
contract CollateralVault {
    IERC20Minimal public immutable token;
    address public exchange;
    address public admin;

    mapping(address => int128) public balanceOf;
    int128 public totalBalances;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Adjusted(address indexed account, int128 delta, bytes32 indexed reason);
    event ExchangeSet(address indexed exchange);

    error NotExchange();
    error NotAdmin();
    error ExchangeAlreadySet();
    error ZeroAmount();
    error TransferFailed();
    error InsufficientBalance(int128 have, uint256 need);

    modifier onlyExchange() {
        if (msg.sender != exchange) revert NotExchange();
        _;
    }

    constructor(IERC20Minimal token_, address admin_) {
        token = token_;
        admin = admin_;
    }

    /// @dev One-shot wiring at deploy time.
    function setExchange(address exchange_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (exchange != address(0)) revert ExchangeAlreadySet();
        exchange = exchange_;
        emit ExchangeSet(exchange_);
    }

    /// @notice Pull `amount` USDC from `from` and credit `account`.
    function depositFor(address from, address account, uint256 amount) external onlyExchange {
        if (amount == 0) revert ZeroAmount();
        if (!token.transferFrom(from, address(this), amount)) revert TransferFailed();
        balanceOf[account] += int128(uint128(amount));
        totalBalances += int128(uint128(amount));
        emit Deposited(account, amount);
    }

    /// @notice Debit `account` and send USDC to `to`. The exchange has already checked margin.
    function withdrawFor(address account, address to, uint256 amount) external onlyExchange {
        if (amount == 0) revert ZeroAmount();
        int128 have = balanceOf[account];
        if (have < int128(uint128(amount))) revert InsufficientBalance(have, amount);
        balanceOf[account] = have - int128(uint128(amount));
        totalBalances -= int128(uint128(amount));
        if (!token.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(account, amount);
    }

    /// @notice Move value between two ledger entries without touching tokens
    ///         (fills, fees, funding, liquidation). Sum of balances is unchanged.
    function transferBetween(address from, address to, int128 amount, bytes32 reason) external onlyExchange {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Adjusted(from, -amount, reason);
        emit Adjusted(to, amount, reason);
    }

    /// @notice Total tokens held against the sum of the ledger. Equal in a
    ///         healthy vault; a gap is the invariant the contract tier watches.
    function reserves() external view returns (uint256 held, int128 ledger) {
        return (token.balanceOf(address(this)), totalBalances);
    }
}
