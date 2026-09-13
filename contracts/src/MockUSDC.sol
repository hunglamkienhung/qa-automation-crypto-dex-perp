// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title A 6-decimal stablecoin for the local chain.
/// @notice `mint` is permissionless on purpose: this token only ever exists on
///         anvil (chain 31337), where anyone being able to fund any account is
///         the whole point. A test that needs a wallet with $10,000 mints it.
contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance(uint256 have, uint256 need);
    error InsufficientAllowance(uint256 have, uint256 need);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(allowed, amount);
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 have = balanceOf[from];
        if (have < amount) revert InsufficientBalance(have, amount);
        balanceOf[from] = have - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
