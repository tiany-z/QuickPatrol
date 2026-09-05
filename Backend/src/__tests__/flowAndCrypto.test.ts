import { describe, expect, it } from "vitest";
import {
  decodeLegacyToken,
  encodeLegacyToken,
  genUUID,
  hashPassword,
  returnError,
  returnSuccess,
  signJwtToken,
  tryCatchErrorToString,
  verifyJwtToken,
  verifyPassword,
} from "../shared/index.js";

describe("Flow & StandardResult", () => {
  it("returnSuccess 应返回正确的结构体", () => {
    const res = returnSuccess({ id: 101, name: "test" });
    expect(res.status).toBe(1);
    expect(res.content).toBe("success");
    expect(res.data).toEqual({ id: 101, name: "test" });
  });

  it("returnError 应返回 status: 0 与错误内容", () => {
    const res = returnError("参数校验失败");
    expect(res.status).toBe(0);
    expect(res.content).toBe("参数校验失败");
    expect(res.data).toBeUndefined();
  });

  it("tryCatchErrorToString 应正确转化各种类型的异常", () => {
    expect(tryCatchErrorToString(new Error("原生错误"))).toBe("原生错误");
    expect(tryCatchErrorToString("字符串异常")).toBe("字符串异常");
    expect(tryCatchErrorToString({ msg: "未知对象" })).toContain("未知对象");
  });
});

describe("Crypto & Token 模块", () => {
  it("genUUID 应生成合法的 v4 UUID 字符串", () => {
    const uuid = genUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("legacyToken 编解码往返一致性测试", () => {
    const payload = JSON.stringify({
      openId: "oJTF_64-PLZZVVceapWDKV3n2BRk",
      time: "2026-09-05 08:38:25",
      id: 3,
    });
    const encoded = encodeLegacyToken(payload);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(10);

    const decoded = decodeLegacyToken(encoded);
    expect(decoded).toBe(payload);
    const parsed = JSON.parse(decoded);
    expect(parsed.openId).toBe("oJTF_64-PLZZVVceapWDKV3n2BRk");
    expect(parsed.id).toBe(3);
  });

  it("decodeLegacyToken 应能准确解密数据库中的历史存量 Token", () => {
    const sampleDbToken =
      "KKyE90zE91BNBBFBAFKyO80zUKzKAzFBAKAyKAzFAzKKyE81BNBBFBCKKyE91BNBBFBCKLeKBLFKyFLBNBAFBBKBUKLeKAyKLAFBAKKyE81BNBAFAwKKyKAzNBBFBAFKyO90zUyzUKzVUzKAzFBAKAyKAzFCDFLeFBOFAwKKyU60zE91BFBiFBXFBQFBjFCIFLtFBxFLvFBiFBiFBmFBmFBYFBcFBBKBLKKyKBBFBBKyyL80yNUyMUyU70zKAzNBBFBAFKyO80zMKyU60zO90zU80zU70zKAzFAzFAxF1";
    const decoded = decodeLegacyToken(sampleDbToken);
    const parsed = JSON.parse(decoded);
    expect(parsed.openId).toBe("oJTF_64-PLZZVVceapWDKV3n2BRk");
    expect(parsed.id).toBe(3);
  });

  it("JWT 标准签发与验证", () => {
    const signRes = signJwtToken({ userId: 101, username: "admin", openId: "test-openid" });
    expect(signRes.status).toBe(1);
    expect(typeof signRes.data).toBe("string");

    const verifyRes = verifyJwtToken(signRes.data!);
    expect(verifyRes.status).toBe(1);
    expect(verifyRes.data?.userId).toBe(101);
    expect(verifyRes.data?.username).toBe("admin");
    expect(verifyRes.data?.openId).toBe("test-openid");
  });

  it("JWT 遇到旧版混淆 Token 时应平滑降级解密", () => {
    const sampleDbToken =
      "KKyE90zE91BNBBFBAFKyO80zUKzKAzFBAKAyKAzFAzKKyE81BNBBFBCKKyE91BNBBFBCKLeKBLFKyFLBNBAFBBKBUKLeKAyKLAFBAKKyE81BNBAFAwKKyKAzNBBFBAFKyO90zUyzUKzVUzKAzFBAKAyKAzFCDFLeFBOFAwKKyU60zE91BFBiFBXFBQFBjFCIFLtFBxFLvFBiFBiFBmFBmFBYFBcFBBKBLKKyKBBFBBKyyL80yNUyMUyU70zKAzNBBFBAFKyO80zMKyU60zO90zU80zU70zKAzFAzFAxF1";
    const verifyRes = verifyJwtToken(sampleDbToken);
    expect(verifyRes.status).toBe(1);
    expect(verifyRes.data?.openId).toBe("oJTF_64-PLZZVVceapWDKV3n2BRk");
    expect(verifyRes.data?.userId).toBe(3);
  });

  it("篡改的 Token 验证应失败返回 status: 0", () => {
    const verifyRes = verifyJwtToken("invalid-malicious-token-12345");
    expect(verifyRes.status).toBe(0);
    expect(verifyRes.content).toContain("Token 验证失败");
  });

  it("Password Bcrypt 哈希与比对", async () => {
    const rawPass = "SchoolAdmin_2026";
    const hashRes = await hashPassword(rawPass);
    expect(hashRes.status).toBe(1);
    expect(hashRes.data).not.toBe(rawPass);

    const matchRes1 = await verifyPassword(rawPass, hashRes.data!);
    expect(matchRes1.status).toBe(1);
    expect(matchRes1.data).toBe(true);

    const matchRes2 = await verifyPassword("WrongPassword", hashRes.data!);
    expect(matchRes2.status).toBe(1);
    expect(matchRes2.data).toBe(false);
  });
});
