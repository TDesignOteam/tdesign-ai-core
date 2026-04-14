/**
 * Re-export from @tdesign/ai-shared for backward compatibility
 */
export {
  JsonPatchError,
  deepClone,
  getValueByPointer,
  applyOperation,
  applyPatch,
  applyReducer,
  validator,
  validate,
  _areEquals,
} from '@tdesign/ai-shared/json-patch';
export type {
  Operation,
  Validator,
  OperationResult,
  BaseOperation,
  AddOperation,
  RemoveOperation,
  ReplaceOperation,
  MoveOperation,
  CopyOperation,
  TestOperation,
  GetOperation,
  AppendOperation,
  PatchResult,
} from '@tdesign/ai-shared/json-patch';
