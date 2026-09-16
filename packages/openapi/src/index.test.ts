import { describe, expect, it } from "vitest";

import { definePlugin as defineMSWPlugin } from "@openapi-to/plugin-msw";
import { definePlugin as defineSWRPlugin } from "@openapi-to/plugin-swr";
import { definePlugin as defineTSRequestPlugin } from "@openapi-to/plugin-ts-request";
import { definePlugin as defineTSTypePlugin } from "@openapi-to/plugin-ts-type";
import { definePlugin as defineVueQueryPlugin } from "@openapi-to/plugin-vue-query";
import { definePlugin as defineReactQueryPlugin } from "@openapi-to/plugin-react-query";
import { definePlugin as defineZodPlugin } from "@openapi-to/plugin-zod";

import {
	pluginMSW,
	pluginSWR,
	pluginTSRequest,
	pluginTSType,
	pluginVueQuery,
	pluginReactQuery,
	pluginZod,
} from "./index";

describe("aggregate plugin exports", () => {
	it("re-exports every official plugin factory from its owning package", () => {
		expect(pluginSWR).toBe(defineSWRPlugin);
		expect(pluginMSW).toBe(defineMSWPlugin);
		expect(pluginTSRequest).toBe(defineTSRequestPlugin);
		expect(pluginTSType).toBe(defineTSTypePlugin);
		expect(pluginVueQuery).toBe(defineVueQueryPlugin);
		expect(pluginReactQuery).toBe(defineReactQueryPlugin);
		expect(pluginZod).toBe(defineZodPlugin);
	});

	it("keeps SWR and MSW as distinct plugin identities", () => {
		expect(pluginSWR).not.toBe(pluginMSW);
		expect(pluginSWR().name).toBe("SWR");
		expect(pluginMSW().name).toBe("MSW");
	});
});
