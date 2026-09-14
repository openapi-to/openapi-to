import { resolve } from "node:path";

import fs from "fs-extra";

type Options = { sanity?: boolean };

const writer = async (path: string, data: string, { sanity }: Options) => {
  try {
    const oldContent = await fs.readFile(resolve(path), {
      encoding: "utf-8",
    });
    if (oldContent?.toString() === data?.toString()) {
      return;
    }
  } catch (_err) {
    /* empty */
  }

  await fs.outputFile(resolve(path), data, { encoding: "utf-8" });

  if (sanity) {
    const savedData = await fs.readFile(resolve(path), {
      encoding: "utf-8",
    });

    if (savedData?.toString() !== data?.toString()) {
      throw new Error(
        `Sanity check failed for ${path}\n\nData[${data.length}]:\n${data}\n\nSaved[${savedData.length}]:\n${savedData}\n`,
      );
    }

    return savedData;
  }

  return data;
};

export async function write(
  path: string,
  data: string,
  options: Options = {},
): Promise<string | undefined> {
  if (data.trim() === "") {
    return undefined;
  }
  return writer(path, data.trim(), options);
}

export async function writeLog(data: string): Promise<string | undefined> {
  if (data.trim() === "") {
    return undefined;
  }
  const path = resolve(process.cwd(), "openapi-log.log");
  let previousLogs = "";

  try {
    previousLogs = await fs.readFile(resolve(path), { encoding: "utf-8" });
  } catch (_err) {
    /* empty */
  }

  return writer(
    path,
    [previousLogs, data.trim()].filter(Boolean).join("\n\n\n"),
    { sanity: false },
  );
}
