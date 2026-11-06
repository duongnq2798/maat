// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Scriptable credit venue. Moves real (mock) tokens; health factors are whatever the test sets.
contract MockCreditAdapter is ICreditAdapter {
    address public immutable vault;
    address public immutable usdc;

    mapping(address => bool) internal _supported;
    mapping(address => uint256) internal _supplied;
    uint256 internal _totalSupplied;
    uint256 internal _debt;
    uint256 internal _healthFactor = type(uint256).max;
    uint256 internal _projectedHf = type(uint256).max;
    /// Health factor the venue reports after borrow/withdraw.
    uint256 public nextHf = type(uint256).max;
    /// minHealthFactor passed by the vault on the last successful borrow/withdraw.
    uint256 public lastMinHf;
    address internal _custodian;
    address internal _operator;

    bool public mutationsRevert;
    bytes internal _revertData;
    bool public viewsRevert;
    /// When set, only debt() reverts (the other views keep working).
    bool public debtReverts;
    /// When set, withdraw/repay succeed but return 0 bytes despite declaring `returns (uint256)`.
    bool public emptyReturns;

    error ViewReverted();

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    modifier mayRevert() {
        if (mutationsRevert) {
            bytes memory d = _revertData;
            assembly ("memory-safe") {
                revert(add(d, 0x20), mload(d))
            }
        }
        _;
    }

    modifier viewGuard() {
        if (viewsRevert) revert ViewReverted();
        _;
    }

    constructor(address vault_, address usdc_) {
        vault = vault_;
        usdc = usdc_;
        _custodian = address(this);
        _operator = address(this);
    }

    // ---------------------------------------------------------------- test controls

    function setSupported(address token, bool s) external {
        _supported[token] = s;
    }

    function setSupplied(address token, uint256 amount) external {
        _totalSupplied = _totalSupplied - _supplied[token] + amount;
        _supplied[token] = amount;
    }

    function setDebt(uint256 d) external {
        _debt = d;
    }

    function setHealthFactor(uint256 hf) external {
        _healthFactor = hf;
    }

    function setProjectedHf(uint256 hf) external {
        _projectedHf = hf;
    }

    function setNextHf(uint256 hf) external {
        nextHf = hf;
    }

    function setCustodian(address c) external {
        _custodian = c;
    }

    function setOperator(address o) external {
        _operator = o;
    }

    function setMutationsRevert(bool on, bytes calldata data) external {
        mutationsRevert = on;
        _revertData = data;
    }

    function setViewsRevert(bool on) external {
        viewsRevert = on;
    }

    function setDebtReverts(bool on) external {
        debtReverts = on;
    }

    function setEmptyReturns(bool on) external {
        emptyReturns = on;
    }

    // ---------------------------------------------------------------- mutations

    function supply(address token, uint256 amount) external onlyVault mayRevert {
        if (!_supported[token]) revert UnsupportedToken(token);
        IERC20Minimal(token).transferFrom(vault, address(this), amount);
        _supplied[token] += amount;
        _totalSupplied += amount;
    }

    function withdraw(address token, uint256 amount, uint256 minHealthFactor)
        external
        onlyVault
        mayRevert
        returns (uint256)
    {
        lastMinHf = minHealthFactor;
        if (nextHf < minHealthFactor) revert HealthFactorTooLow(nextHf, minHealthFactor);
        _supplied[token] -= amount;
        _totalSupplied -= amount;
        IERC20Minimal(token).transfer(vault, amount);
        if (emptyReturns) _returnNothing();
        return amount;
    }

    function borrow(uint256 amount, uint256 minHealthFactor) external onlyVault mayRevert {
        lastMinHf = minHealthFactor;
        if (nextHf < minHealthFactor) revert HealthFactorTooLow(nextHf, minHealthFactor);
        _debt += amount;
        IERC20Minimal(usdc).transfer(vault, amount);
    }

    function repay(uint256 amount) external onlyVault mayRevert returns (uint256 repaid) {
        repaid = amount < _debt ? amount : _debt;
        if (repaid != 0) IERC20Minimal(usdc).transferFrom(vault, address(this), repaid);
        _debt -= repaid;
        if (emptyReturns) _returnNothing();
    }

    function _returnNothing() internal pure {
        assembly ("memory-safe") {
            return(0, 0)
        }
    }

    // ---------------------------------------------------------------- views

    function supportsToken(address token) external view viewGuard returns (bool) {
        return _supported[token];
    }

    function suppliedOf(address token) external view viewGuard returns (uint256) {
        return _supplied[token];
    }

    function debt() external view viewGuard returns (uint256) {
        if (debtReverts) revert ViewReverted();
        return _debt;
    }

    function healthFactor() external view viewGuard returns (uint256) {
        return _healthFactor;
    }

    function projectedHealthFactorAfterBorrow(uint256) external view viewGuard returns (uint256) {
        return _projectedHf;
    }

    function hasPosition() external view viewGuard returns (bool) {
        return _debt != 0 || _totalSupplied != 0;
    }

    function collateralCustodian(address) external view viewGuard returns (address) {
        return _custodian;
    }

    function collateralOperator() external view viewGuard returns (address) {
        return _operator;
    }
}
