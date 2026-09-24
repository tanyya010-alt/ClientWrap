/** Shared between server actions and client forms (no server imports here). */
export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  upgradeTo?: string | null;
  data?: any;
} | null;
