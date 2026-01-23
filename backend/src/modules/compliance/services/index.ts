// Context and rules
export { ContextBuilderService, ContextBuildInput } from './context-builder.service';
export { RuleResolverService } from './rule-resolver.service';

// VAT calculation
export {
  VATEngineService,
  VATCalculationInput,
  VATCalculationResult,
  VATBreakdownItem,
  VATEngineRules,
} from './vat-engine.service';

// Numbering
export {
  NumberingService,
  NumberingContext,
  GeneratedNumber,
  NumberingState,
} from './numbering.service';

// Hash chain
export {
  HashChainService,
  HashInput,
  HashResult,
  ChainValidationResult,
} from './hash-chain.service';

// QR code
export { QRCodeService, QRCodeInput, QRCodeResult } from './qr-code.service';

// Correction
export {
  CorrectionService,
  CorrectionContext,
  CorrectionRequest,
  CorrectionResult,
} from './correction.service';

// External validation
export { VIESService } from './vies.service';

// Signature
export {
  XadesSignatureService,
  SignatureConfig,
  SignatureResult,
} from './xades-signature.service';
