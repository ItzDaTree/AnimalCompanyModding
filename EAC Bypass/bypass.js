const SYMBOLS_URL = "https://pastebin.com/raw/Zu0XQyEA";

/* =========================================================
   URL PARSER
========================================================= */
function parseUrl(url) {
  const match = url.match(/^https?:\/\/([^/:]+)(?::(\d+))?(.*)$/);
  if (!match) {
    return { hostname: "", path: "/", port: 443 };
  }
  return {
    hostname: match[1],
    path: match[3] || "/",
    port: match[2] ? parseInt(match[2]) : (url.startsWith("https") ? 443 : 80),
  };
}

/* =========================================================
   WINHTTP REQUEST
========================================================= */
function httpRequest(url, method) {
  method = method || "GET";

  return new Promise(function (resolve) {
    try {
      const winhttp = Module.load("winhttp.dll");

      const WinHttpOpen = new NativeFunction(winhttp.getExportByName("WinHttpOpen"), "pointer", ["pointer", "uint32", "pointer", "pointer", "uint32"]);
      const WinHttpConnect = new NativeFunction(winhttp.getExportByName("WinHttpConnect"), "pointer", ["pointer", "pointer", "uint32", "uint32"]);
      const WinHttpOpenRequest = new NativeFunction(winhttp.getExportByName("WinHttpOpenRequest"), "pointer", ["pointer", "pointer", "pointer", "pointer", "pointer", "pointer", "uint32"]);
      const WinHttpSendRequest = new NativeFunction(winhttp.getExportByName("WinHttpSendRequest"), "bool", ["pointer", "pointer", "uint32", "pointer", "uint32", "uint32", "pointer"]);
      const WinHttpReceiveResponse = new NativeFunction(winhttp.getExportByName("WinHttpReceiveResponse"), "bool", ["pointer", "pointer"]);
      const WinHttpQueryHeaders = new NativeFunction(winhttp.getExportByName("WinHttpQueryHeaders"), "bool", ["pointer", "uint32", "pointer", "pointer", "pointer", "pointer"]);
      const WinHttpReadData = new NativeFunction(winhttp.getExportByName("WinHttpReadData"), "bool", ["pointer", "pointer", "uint32", "pointer"]);
      const WinHttpCloseHandle = new NativeFunction(winhttp.getExportByName("WinHttpCloseHandle"), "bool", ["pointer"]);
      const WinHttpSetOption = new NativeFunction(winhttp.getExportByName("WinHttpSetOption"), "bool", ["pointer", "uint32", "pointer", "uint32"]);
      const WinHttpSetTimeouts = new NativeFunction(winhttp.getExportByName("WinHttpSetTimeouts"), "bool", ["pointer", "int32", "int32", "int32", "int32"]);
      const GetLastError = new NativeFunction(Module.load("kernel32.dll").getExportByName("GetLastError"), "uint32", []);

      const urlParts = parseUrl(url);
      const userAgent = Memory.allocUtf16String("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

      const hSession = WinHttpOpen(userAgent, 0, ptr(0), ptr(0), 0);
      if (hSession.isNull()) {
        resolve({ status: 0, data: "WinHttpOpen failed" });
        return;
      }

      WinHttpSetTimeouts(hSession, 5000, 5000, 5000, 5000);

      const hConnect = WinHttpConnect(hSession, Memory.allocUtf16String(urlParts.hostname), urlParts.port, 0);
      if (hConnect.isNull()) {
        WinHttpCloseHandle(hSession);
        resolve({ status: 0, data: "WinHttpConnect failed" });
        return;
      }

      const hRequest = WinHttpOpenRequest(
        hConnect,
        Memory.allocUtf16String(method),
        Memory.allocUtf16String(urlParts.path),
        ptr(0),
        ptr(0),
        ptr(0),
        url.startsWith("https") ? 0x00800000 : 0
      );

      if (hRequest.isNull()) {
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        resolve({ status: 0, data: "WinHttpOpenRequest failed" });
        return;
      }

      // Ignore SSL errors
      const flagsBuf = Memory.alloc(4);
      flagsBuf.writeU32(0x00000100 | 0x00000200 | 0x00001000 | 0x00002000);
      WinHttpSetOption(hRequest, 31, flagsBuf, 4);

      if (!WinHttpSendRequest(hRequest, ptr(0), 0, ptr(0), 0, 0, ptr(0))) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        resolve({ status: 0, data: "WinHttpSendRequest failed" });
        return;
      }

      if (!WinHttpReceiveResponse(hRequest, ptr(0))) {
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
        resolve({ status: 0, data: "WinHttpReceiveResponse failed" });
        return;
      }

      const statusBuffer = Memory.alloc(4);
      const statusSize = Memory.alloc(4);
      statusSize.writeU32(4);
      WinHttpQueryHeaders(hRequest, 0x20000013, ptr(0), statusBuffer, statusSize, ptr(0));
      const statusCode = statusBuffer.readU32();

      const buffer = Memory.alloc(8192);
      const bytesRead = Memory.alloc(4);
      let responseData = "";

      while (WinHttpReadData(hRequest, buffer, 8192, bytesRead)) {
        const size = bytesRead.readU32();
        if (size === 0) break;
        responseData += buffer.readUtf8String(size);
      }

      WinHttpCloseHandle(hRequest);
      WinHttpCloseHandle(hConnect);
      WinHttpCloseHandle(hSession);

      resolve({ status: statusCode, data: responseData });
    } catch (e) {
      resolve({ status: 0, data: "Error: " + e });
    }
  });
}

/* =========================================================
   MAIN
========================================================= */
async function setupIl2CppExports() {
  console.log("[+] Downloading symbols from Pastebin...");

  const res = await httpRequest(SYMBOLS_URL);

  if (res.status !== 200) {
    console.log("[-] Download failed:", res.data);
    return;
  }

  let mapping;
  try {
    mapping = JSON.parse(res.data);
  } catch (e) {
    console.log("[-] JSON parse error:", e);
    return;
  }

  // Build the exports table
  Il2Cpp.$config.exports = {};

  let count = 0;
  for (const stdName in mapping) {
    if (!Object.prototype.hasOwnProperty.call(mapping, stdName)) continue;

    const obfuscated = mapping[stdName];
    if (typeof obfuscated !== "string") continue;

    Il2Cpp.$config.exports[stdName] = function () {
      return Il2Cpp.module.findExportByName(obfuscated);
    };

    // Also add the obfuscated name as alias
    Il2Cpp.$config.exports[obfuscated] = Il2Cpp.$config.exports[stdName];

    count++;
  }

  console.log("[+] Built Il2Cpp.$config.exports with " + count + " entries");
  console.log("[+] Done – exports are ready");
}

setupIl2CppExports();

Il2Cpp.perform(() => {
    try {
        const gameAssembly = Il2Cpp.domain.assembly("AnimalCompany").image;
        const eacManager = gameAssembly.class("AnimalCompany.EACClientManager");
        const setPhase = eacManager.method("SetPhase", 1);
        const originalSetPhase = setPhase.implementation;
        setPhase.implementation = function () {
            if (originalSetPhase) return originalSetPhase.call(this, 1);
            return this.method("SetPhase", 1).invoke(1);
        };

        eacManager.method("get_HasFinished", 0).implementation = function () {
            return true;
        };
        eacManager.method("IsClientValidated", 0).implementation = function () {
            return true;
        };
        eacManager.method("DidFailUnprotected", 0).implementation = function () {
            return false;
        };
        eacManager.method("DecodePhase", 0).implementation = function () {
            return 1;
        };
    } catch (error) {
    }
    console.log('---------------------------');
    console.log('[+] Creds to ItzDaTree');
    console.log('---------------------------');
});
