// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockB20 {
    string public symbol;
    uint8 public constant decimals = 8;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(uint8 => bool) public isPaused;
    mapping(bytes32 => uint64) public policyId;
    uint256 public uiMultiplier = 1e18;
    uint256 public effectiveAt;

    error ContractPaused(uint8 feature);

    constructor(string memory symbol_) {
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setPaused(uint8 feature, bool p) external {
        isPaused[feature] = p;
    }

    function setPolicyId(bytes32 scope, uint64 id) external {
        policyId[scope] = id;
    }

    function setUiMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setEffectiveAt(uint256 t) external {
        effectiveAt = t;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf[account] * uiMultiplier / 1e18;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (isPaused[0]) revert ContractPaused(0);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
