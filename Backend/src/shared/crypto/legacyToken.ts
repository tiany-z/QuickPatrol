/**
 * 兼容旧版小程序所使用的自定义对称混淆 Token 编解码算法
 */

function isLetter(code: number): number {
  if (code >= 65 && code <= 90) return 1;
  if (code >= 97 && code <= 122) return 1;
  if (code > 90 && code < 97) return 2;
  if (code < 65) return 0;
  return 2;
}

function getNumberString(n: number | string, x: number): string {
  let str = JSON.stringify(n);
  for (let i = str.length; i < x; i++) {
    str = "0" + str;
  }
  return str;
}

export function encodeLegacyToken(string: string): string {
  const chars = string.split("");
  let string1 = "";
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    string1 += JSON.stringify(JSON.stringify(code).length) + JSON.stringify(code);
  }
  const s1Arr = string1.split("");
  for (let i = 0; i < s1Arr.length; i++) {
    if (s1Arr[i] === "0") continue;
    let c = i;
    let ss = s1Arr[c];
    while (true) {
      const cd = isLetter(parseInt(ss, 10));
      if (cd === 2) break;
      if (cd === 1) {
        s1Arr[c] = String.fromCharCode(parseInt(ss, 10));
        for (let i1 = i; i1 < c; i1++) {
          s1Arr[i1] = "-";
        }
        i = c;
        break;
      }
      c++;
      if (c === s1Arr.length) break;
      ss += s1Arr[c];
    }
  }

  for (let i = 0; i < s1Arr.length - 1; i++) {
    if (s1Arr[i] === "2" && s1Arr[i + 1] === "2") {
      s1Arr[i] = "?";
      s1Arr[i + 1] = "-";
    }
  }

  const string2: string[] = [];
  for (let i = 0; i < s1Arr.length; i++) {
    if (s1Arr[i] === "-") continue;
    const code = s1Arr[i].charCodeAt(0);
    string2.push(
      JSON.stringify(Math.floor(code / 52)) + getNumberString(code % 52, 2)
    );
  }

  let string3 = "";
  for (let i = string2.length - 1; i >= 0; i--) {
    string3 += string2[i];
  }

  const s3Arr = string3.split("");
  const string4: string[] = [];
  for (let i = 0; i < s3Arr.length; i += 2) {
    let ch = s3Arr[i];
    if (i + 1 !== s3Arr.length) {
      ch += s3Arr[i + 1];
    }
    const val = parseInt(ch, 10);
    if (val < 52 && ch.length === 2) {
      if (val < 26) {
        string4.push(String.fromCharCode(val + 65));
      } else {
        string4.push(String.fromCharCode(val + 97 - 26));
      }
    } else {
      string4.push(ch);
    }
  }

  return string4.join("");
}

export function decodeLegacyToken(str: string): string {
  const chars = str.split("");
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0);
    if (code >= 48 && code <= 56) continue;
    if (code <= 90) {
      chars[i] = getNumberString(code - 65, 2);
    } else {
      chars[i] = getNumberString(code - 97 + 26, 2);
    }
  }

  let string2 = "";
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "-8") {
      string2 += "9";
      continue;
    }
    string2 += chars[i];
  }

  const s2Arr = string2.split("");
  const string3: string[] = [];
  for (let i = 0; i < s2Arr.length; i += 3) {
    string3.push(
      getNumberString(
        parseInt(s2Arr[i], 10) * 52 + parseInt(s2Arr[i + 1] + s2Arr[i + 2], 10),
        3
      )
    );
  }

  const string4: string[] = [];
  for (let i = string3.length - 1; i >= 0; i--) {
    string4.push(String.fromCharCode(parseInt(string3[i], 10)));
  }

  let string5 = "";
  for (let i = 0; i < string4.length; i++) {
    if (string4[i] === "?") {
      string5 += "22";
      continue;
    }
    const c = string4[i].charCodeAt(0);
    if (!(c >= 48 && c <= 57)) {
      string5 += JSON.stringify(c);
      continue;
    }
    string5 += string4[i];
  }

  const s5Arr = string5.split("");
  let string6 = "";
  for (let i = 0; i < s5Arr.length; i++) {
    const n = parseInt(s5Arr[i], 10);
    let s = "";
    for (let i1 = 0; i1 < n; i1++) {
      s += s5Arr[i + 1 + i1];
    }
    string6 += String.fromCharCode(parseInt(s, 10));
    i += n;
  }

  return string6;
}
