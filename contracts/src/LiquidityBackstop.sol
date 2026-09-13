// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20Minimal } from "./CollateralVault.sol";
import { IExchangeForFund } from "./InsuranceFund.sol";

/// @title The maker of last resort.
/// @notice A market order on an empty book still has to fill, or the venue is
///         unusable on a quiet chain. This account stands ready on both sides
///         at the index price plus/minus the market's backstop spread, up to
///         the market's backstop size per fill. The exchange fills against it
///         when it is the best price available or the book is exhausted, and
///         it takes the opposite position like any other maker -- so it needs
///         collateral, and it can be liquidated like anyone else.
///
///         On the order book it reports as source 1; in fill events its maker
///         address is zero. That is how a reader tells "matched a trader" from
///         "absorbed by the backstop" -- the same split a vAMM venue publishes.
contract LiquidityBackstop {
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

    function fund(uint256 amount) external {
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (!exchange.accountExists(address(this))) exchange.initializeAccount();
        (bool ok,) = address(token).call(abi.encodeWithSignature("approve(address,uint256)", vault, amount));
        if (!ok) revert TransferFailed();
        exchange.deposit(amount);
        emit Funded(msg.sender, amount);
    }

    function drain(address to, uint256 amount) external {
        if (msg.sender != admin) revert NotAdmin();
        exchange.withdraw(amount);
        if (!token.transfer(to, amount)) revert TransferFailed();
        emit Drained(to, amount);
    }
}
