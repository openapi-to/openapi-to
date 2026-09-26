export type OpenapiToSingleConfig = {
	/**
	 * Project name
	 */
	name?: string;
	root: string;
	input: OpenapiToConfigSingleInput;
	output: OpenapiToConfigSingleOutput;
	// biome-ignore lint/suspicious/noExplicitAny: Preserve the legacy public plugin array contract.
	plugins: Array<any>;
};

export type OpenapiToConfigSingleInput = {
	/**
	 * api document path
	 */
	path: string;
	/** Security policy for remote documents and external references. */
	remote?: RemoteSourceOptions;
};

export type RemoteSourceOptions = {
	/** Extra hostnames allowed for derived cross-origin $ref and redirect requests; roots are caller-authorized. */
	allowedHosts?: string[];
	/** Request headers restricted to the initial root origin. */
	headers?: Record<string, string>;
	timeoutMs?: number;
	maxResponseBytes?: number;
	maxRedirects?: number;
};

export type OutputBase = "managed" | "workspace";

export type OpenapiToConfigSingleOutput = {
	/**
	 * Resolve output below `.openapi-to` (`managed`, the default) or directly
	 * below the project Workspace (`workspace`).
	 */
	base?: OutputBase;
	/**
	 * which is used to output the name of the folder
	 */
	dir: string;
	/**
	 * Specifies the formatting tool to be used.
	 */
	format?: "biome";
	/**
	 * Clean the output directory before each build.
	 */
	clean?: boolean;
};

export type OpenapiToConfigServer = {
	/**
	 * Project name
	 */
	name?: string;
	input: OpenapiToConfigSingleInput;
	output: OpenapiToConfigSingleOutput;
};

/**
 * @private
 */
export type OpenapiToConfig = {
	/** Array of OpenapiTo project to use.*/
	servers: Array<OpenapiToConfigServer>;
	/**
	 * Array of OpenapiTo plugins to use.
	 * The plugin/package can forsee some options that you need to pass through.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Preserve the legacy public plugin array contract.
	plugins: Array<any>;
};
