"use strict";

const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

/** Preserve the security fuses formerly applied by Electron Forge. */
module.exports = async (context) => {
  const productFilename = context.packager.appInfo.productFilename;
  const executableName = context.electronPlatformName === "linux"
    ? context.packager.config.executableName
    : productFilename;
  const executable =
    context.electronPlatformName === "darwin"
      ? path.join(
          context.appOutDir,
          `${productFilename}.app`,
          "Contents",
          "MacOS",
          executableName,
        )
      : path.join(
          context.appOutDir,
          `${executableName}${context.electronPlatformName === "win32" ? ".exe" : ""}`,
        );

  await flipFuses(executable, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature:
      context.electronPlatformName === "darwin" && context.arch === "arm64",
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
