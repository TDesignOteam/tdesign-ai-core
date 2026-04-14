/**
 * Re-export from @tdesign/ai-shared for backward compatibility
 */
import { applyPatchImmutable, applyPatch } from '@tdesign/ai-shared';
import type { ImmutablePatchOperation } from '@tdesign/ai-shared';

export type Operation = ImmutablePatchOperation;
export { applyPatchImmutable, applyPatch };
