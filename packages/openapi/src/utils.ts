import updateNotifier from "update-notifier";

import packageJson from "../package.json" with { type: "json" };

export function updateVersionNotifier() {
  updateNotifier({ pkg: packageJson,shouldNotifyInNpmScript:true }).notify();
}

export function version(): string {
  return packageJson.version || "";
}

export function validateVersion(version: string) {

}
