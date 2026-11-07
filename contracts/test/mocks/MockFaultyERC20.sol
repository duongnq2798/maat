// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice 6-decimal ERC-20 whose transfer() / approve() can be switched to return false or revert.
contract MockFaultyERC20 {
    enum Mode {
        OK,
        RETURN_FALSE,
        REVERT
    }

    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    Mode public transferMode;
    Mode public approveMode;

    error Faulty();

    function setModes(Mode transferMode_, Mode approveMode_) external {
        transferMode = transferMode_;
        approveMode = approveMode_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (approveMode == Mode.REVERT) revert Faulty();
        if (approveMode == Mode.RETURN_FALSE) return false;
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferMode == Mode.REVERT) revert Faulty();
        if (transferMode == Mode.RETURN_FALSE) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
