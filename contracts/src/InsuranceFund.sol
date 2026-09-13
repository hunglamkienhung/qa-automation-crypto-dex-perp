// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20Minimal } from "./CollateralVault.sol";

interface IExchangeForFund {
    function initializeAccount() external;
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function accountExists(address account) external view returns (bool);
}

/// @title The account that absorbs bad debt left by liquidations.
/// @notice It is an ordinary account on the exchange whose address is known to
///         the exchange. Its balance in the vault IS the fund. When a
///         liquidated account ends below zero, the exchange moves value from
///         here to bring it back to zero; when this account is empty too, the
///         exchange auto-deleverages instead. Anyone can top it up; only the
///         admin can drain it.
contract InsuranceFund {
    IERC20Minimal public immutable token;
    IExchangeForFund public immutable exchange;
    address public immutable vault;
    address public admin;

    event Funded(address indexed by, uint256 amount);
    event Drained(address indexed to, uint256 amount);

    error NotAdmin();
    error TransferFailed();

    constructor(IERC20Minimal token_, IExchangeForFund exchange_, address vault_, address admin_) {
        token = token_;
        exchange = exchange_;
        vault = vault_;
        admin = admin_;
    }

    /// @notice Pull USDC from the caller into this account's exchange balance.
    function fund(uint256 amount) external {
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (!exchange.accountExists(address(this))) exchange.initializeAccount();
        _approve(amount);
        exchange.deposit(amount);
        emit Funded(msg.sender, amount);
    }

    function drain(address to, uint256 amount) external {
        if (msg.sender != admin) revert NotAdmin();
        exchange.withdraw(amount);
        if (!token.transfer(to, amount)) revert TransferFailed();
        emit Drained(to, amount);
    }

    function _approve(uint256 amount) internal {
        // MockUSDC-style approve; a real token would use the same selector.
        (bool ok,) = address(token).call(abi.encodeWithSignature("approve(address,uint256)", vault, amount));
        if (!ok) revert TransferFailed();
    }
}
