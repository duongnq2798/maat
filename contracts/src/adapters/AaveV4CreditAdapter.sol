// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICreditAdapter} from "./ICreditAdapter.sol";
import {IAaveV4Spoke, IAaveV4Oracle} from "../interfaces/IAaveV4.sol";
import {IERC20Minimal} from "../interfaces/IExternal.sol";
import {TokenTransfer} from "../lib/TokenTransfer.sol";

/// @title AaveV4CreditAdapter — one Aave V4 spoke position owned by one MandateVault.
/// @notice The adapter is the Aave user: it holds the collateral and the debt, and only its vault can move them.
/// Everything withdrawn or borrowed goes straight to the vault. borrow() and withdraw() re-read the health factor
/// after the action and revert below the vault's minimum, so the minimum holds even if a projection was off.
contract AaveV4CreditAdapter is ICreditAdapter {
    using TokenTransfer for address;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant VALUE_DECIMALS = 26; // Aave V4 value units: 1e26 = 1 USD

    address public immutable vault;
    address public immutable usdc;
    IAaveV4Spoke public immutable spoke;
    /// Holds every supplied collateral token; the spoke pulls supplies into it and it sends withdrawals out.
    address public immutable hub;
    uint256 public immutable usdcReserveId;
    /// Converts raw USDC x oracle price into Aave value units.
    uint256 internal immutable _usdcToValue;

    mapping(address => uint256) internal _reserveIdPlusOne;
    address[] internal _collaterals;

    error ZeroAddress();
    error LengthMismatch();
    error ReserveMismatch(uint256 reserveId);

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    /// @param tokens_ collateral tokens; reserveIds_[i] is tokens_[i]'s reserve on `spoke_`. Each reserve must list
    /// that token as its underlying and share the USDC reserve's hub.
    constructor(
        address vault_,
        address usdc_,
        address spoke_,
        uint256 usdcReserveId_,
        address[] memory tokens_,
        uint256[] memory reserveIds_
    ) {
        if (vault_ == address(0) || usdc_ == address(0) || spoke_ == address(0)) revert ZeroAddress();
        if (tokens_.length != reserveIds_.length) revert LengthMismatch();
        IAaveV4Spoke s = IAaveV4Spoke(spoke_);
        IAaveV4Spoke.Reserve memory u = s.getReserve(usdcReserveId_);
        if (u.underlying != usdc_ || u.hub == address(0)) revert ReserveMismatch(usdcReserveId_);
        for (uint256 i; i < tokens_.length; ++i) {
            address t = tokens_[i];
            IAaveV4Spoke.Reserve memory r = s.getReserve(reserveIds_[i]);
            if (t == address(0) || t == usdc_ || r.underlying != t || r.hub != u.hub || _reserveIdPlusOne[t] != 0) {
                revert ReserveMismatch(reserveIds_[i]);
            }
            _reserveIdPlusOne[t] = reserveIds_[i] + 1;
            _collaterals.push(t);
        }
        vault = vault_;
        usdc = usdc_;
        spoke = s;
        hub = u.hub;
        usdcReserveId = usdcReserveId_;
        _usdcToValue = 10 ** (VALUE_DECIMALS - uint256(u.decimals) - uint256(IAaveV4Oracle(s.ORACLE()).decimals()));
    }

    // ------------------------------------------------------------------ vault actions

    function supply(address token, uint256 amount) external onlyVault {
        uint256 id = _reserveId(token);
        token.safeTransferFrom(vault, address(this), amount);
        token.safeApprove(address(spoke), amount);
        spoke.supply(id, amount, address(this));
        token.safeApprove(address(spoke), 0);
        // Aave V4 does not enable collateral on supply
        (bool enabled,) = spoke.getUserReserveStatus(id, address(this));
        if (!enabled) spoke.setUsingAsCollateral(id, true, address(this));
    }

    function withdraw(address token, uint256 amount, uint256 minHealthFactor)
        external
        onlyVault
        returns (uint256 withdrawn)
    {
        uint256 id = _reserveId(token);
        uint256 before = IERC20Minimal(token).balanceOf(address(this));
        spoke.withdraw(id, amount, address(this));
        _requireHealthy(minHealthFactor);
        withdrawn = IERC20Minimal(token).balanceOf(address(this)) - before;
        token.safeTransfer(vault, withdrawn);
    }

    function borrow(uint256 amount, uint256 minHealthFactor) external onlyVault {
        uint256 before = IERC20Minimal(usdc).balanceOf(address(this));
        spoke.borrow(usdcReserveId, amount, address(this));
        _requireHealthy(minHealthFactor);
        usdc.safeTransfer(vault, IERC20Minimal(usdc).balanceOf(address(this)) - before);
    }

    function repay(uint256 amount) external onlyVault returns (uint256 repaid) {
        uint256 owed = debt();
        repaid = amount < owed ? amount : owed;
        if (repaid != 0) {
            usdc.safeTransferFrom(vault, address(this), repaid);
            usdc.safeApprove(address(spoke), repaid);
            spoke.repay(usdcReserveId, repaid, address(this));
            usdc.safeApprove(address(spoke), 0);
        }
        // whatever the spoke did not take goes back, so no USDC ever rests here
        uint256 left = IERC20Minimal(usdc).balanceOf(address(this));
        if (left != 0) usdc.safeTransfer(vault, left);
    }

    // ------------------------------------------------------------------ views

    function supportsToken(address token) external view returns (bool) {
        return _reserveIdPlusOne[token] != 0;
    }

    function collaterals() external view returns (address[] memory) {
        return _collaterals;
    }

    function suppliedOf(address token) public view returns (uint256) {
        uint256 p = _reserveIdPlusOne[token];
        return p == 0 ? 0 : spoke.getUserSuppliedAssets(p - 1, address(this));
    }

    function debt() public view returns (uint256) {
        return spoke.getUserTotalDebt(usdcReserveId, address(this));
    }

    function healthFactor() public view returns (uint256) {
        return spoke.getUserAccountData(address(this)).healthFactor;
    }

    function hasPosition() external view returns (bool) {
        if (debt() != 0) return true;
        for (uint256 i; i < _collaterals.length; ++i) {
            if (suppliedOf(_collaterals[i]) != 0) return true;
        }
        return false;
    }

    /// @notice HF = collateral value x avgCF / debt value, with the new debt valued at the spoke oracle's USDC
    /// price. Matched Aave's own post-borrow HF on a Base fork. Existing debt is rounded up.
    function projectedHealthFactorAfterBorrow(uint256 amount) external view returns (uint256) {
        IAaveV4Spoke.UserAccountData memory d = spoke.getUserAccountData(address(this));
        uint256 price = IAaveV4Oracle(spoke.ORACLE()).getReservePrice(usdcReserveId);
        uint256 debtValue = _ceilDiv(d.totalDebtValueRay, RAY) + amount * price * _usdcToValue;
        if (debtValue == 0) return type(uint256).max;
        return d.totalCollateralValue * d.avgCollateralFactor / debtValue;
    }

    function collateralCustodian(address) external view returns (address) {
        return hub;
    }

    function collateralOperator() external view returns (address) {
        return address(spoke);
    }

    // ------------------------------------------------------------------ internal

    function _reserveId(address token) internal view returns (uint256) {
        uint256 p = _reserveIdPlusOne[token];
        if (p == 0) revert UnsupportedToken(token);
        return p - 1;
    }

    function _requireHealthy(uint256 minHealthFactor) internal view {
        uint256 hf = healthFactor();
        if (hf < minHealthFactor) revert HealthFactorTooLow(hf, minHealthFactor);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }
}
