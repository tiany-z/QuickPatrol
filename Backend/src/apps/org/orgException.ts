/**
 * M17: Flow Lock 业务连续性熔断专属异常与诊断上下文
 */

import { IBusinessLockContext } from "../../shared/flow/flowLockTypes.js";

export type IBusinessLockDetail = IBusinessLockContext;

export class BusinessLockException extends Error {
  public readonly isBusinessLock: boolean = true;
  public readonly httpStatus: number = 409;
  public readonly statusCode: number = 409;
  public readonly code: string = "FLOW_LOCK_BLOCKED";
  public readonly errorCode: string = "FLOW_LOCK_BLOCKED";
  public readonly detail: IBusinessLockContext;
  public readonly context: IBusinessLockContext;

  constructor(message: string, detail: IBusinessLockContext) {
    super(message);
    this.name = "BusinessLockException";
    this.detail = detail;
    this.context = detail;
    Object.setPrototypeOf(this, BusinessLockException.prototype);
  }
}
