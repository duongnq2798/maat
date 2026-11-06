// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPolicyRegistry {
    mapping(uint64 => mapping(address => bool)) internal _allowed;
    mapping(uint64 => bool) internal _exists;

    function setAuthorized(uint64 id, address account, bool ok) external {
        _allowed[id][account] = ok;
        _exists[id] = true;
    }

    function isAuthorized(uint64 id, address account) external view returns (bool) {
        return _allowed[id][account];
    }

    function policyExists(uint64 id) external view returns (bool) {
        return id == 0 || _exists[id];
    }
}
