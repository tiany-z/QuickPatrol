import bcrypt from "bcryptjs";
import { returnError, returnSuccess, StandardResult, tryCatchErrorToString } from "../flow/result.js";

export async function hashPassword(password: string, rounds: number = 10): Promise<StandardResult<string>> {
  try {
    const salt = await bcrypt.genSalt(rounds);
    const hash = await bcrypt.hash(password, salt);
    return returnSuccess(hash);
  } catch (error) {
    return returnError(`Hash password failed: ${tryCatchErrorToString(error)}`);
  }
}

export async function verifyPassword(password: string, hash: string): Promise<StandardResult<boolean>> {
  try {
    const isMatch = await bcrypt.compare(password, hash);
    return returnSuccess(isMatch);
  } catch (error) {
    return returnError(`Verify password failed: ${tryCatchErrorToString(error)}`);
  }
}
