// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockB20 {
    string public symbol;
    uint8 public constant decimals = 8;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(uint8 => bool) internal _paused;
    mapping(bytes32 => uint64) internal _policyId;
    uint256 internal _uiMultiplier = 1e18;
    uint256 internal _effectiveAt;

    bool public revertIsPaused;
    bool public revertPolicyId;
    bool public revertUiMultiplier;
    bool public revertEffectiveAt;

    error ContractPaused(uint8 feature);

    constructor(string memory symbol_) {
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setPaused(uint8 feature, bool p) external {
        _paused[feature] = p;
    }

    function setPolicyId(bytes32 scope, uint64 id) external {
        _policyId[scope] = id;
    }

    function setUiMultiplier(uint256 m) external {
        _uiMultiplier = m;
    }

    function setEffectiveAt(uint256 t) external {
        _effectiveAt = t;
    }

    function setReverts(bool isPaused_, bool policyId_, bool uiMultiplier_, bool effectiveAt_) external {
        revertIsPaused = isPaused_;
        revertPolicyId = policyId_;
        revertUiMultiplier = uiMultiplier_;
        revertEffectiveAt = effectiveAt_;
    }

    function isPaused(uint8 feature) external view returns (bool) {
        if (revertIsPaused) revert("isPaused");
        return _paused[feature];
    }

    function policyId(bytes32 scope) external view returns (uint64) {
        if (revertPolicyId) revert("policyId");
        return _policyId[scope];
    }

    function uiMultiplier() external view returns (uint256) {
        if (revertUiMultiplier) revert("uiMultiplier");
        return _uiMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        if (revertEffectiveAt) revert("effectiveAt");
        return _effectiveAt;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf[account] * _uiMultiplier / 1e18;
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
        if (_paused[0]) revert ContractPaused(0);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
