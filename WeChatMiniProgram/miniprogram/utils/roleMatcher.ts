import { RoleBitmask } from "../typings/router.js";

export { RoleBitmask };

/**
 * M09: 基于位掩码的高性能多角色权限判定算法 (Role Bitmask Matcher)
 * O(1) 极速位运算，支撑六级角色与多身份组合准入
 */
export class RoleMatcher {
  /**
   * 将数字角色数组转换为二进制位掩码
   * 0: 学生(2), 1: 教职工(4), 2: 师傅(8), 3: 质检(16), 4: 主管(32), 5: 校管(64), 9: 超管(128)
   */
  public static rolesToMask(roles: number[]): number {
    if (!roles || roles.length === 0) {
      return RoleBitmask.GUEST;
    }
    return roles.reduce((acc, role) => {
      switch (role) {
        case 0:
          return acc | RoleBitmask.STUDENT;
        case 1:
          return acc | RoleBitmask.STAFF;
        case 2:
          return acc | RoleBitmask.WORKER;
        case 3:
          return acc | RoleBitmask.INSPECTOR;
        case 4:
          return acc | RoleBitmask.SUPERVISOR;
        case 5:
          return acc | RoleBitmask.ADMIN;
        case 9:
          return acc | RoleBitmask.ROOT;
        default:
          return acc;
      }
    }, 0);
  }

  /**
   * 极速 O(1) 判定当前用户是否命中微应用准入权限
   */
  public static hasAccess(userRoleMask: number, appRequiredMask: number): boolean {
    // 超管无条件拥有全域通行权
    if ((userRoleMask & RoleBitmask.ROOT) !== 0) {
      return true;
    }
    // 位与运算：非 0 即具备至少一个交集角色
    return (userRoleMask & appRequiredMask) !== 0;
  }
}
