export type ImportDeclaration = {
	namedImports: string[];
	moduleSpecifier: string;
};

export type PluginConfig = {
	/** Whether operation-local React hooks are emitted. Defaults to true. */
	hooks?: boolean;
	/** Whether generated relative imports include `.ts`. Defaults to true. */
	importWithExtension?: boolean;
	/** Type used by the generated request client's final argument. */
	requestConfigTypeImportDeclaration?: ImportDeclaration;
	/** Type used for the generated query and mutation error generic. */
	responseErrorTypeImportDeclaration?: ImportDeclaration;
};

export type ResolvedPluginConfig = {
	hooks: boolean;
	importWithExtension: boolean;
	requestConfigTypeImportDeclaration: ImportDeclaration;
	responseErrorTypeImportDeclaration: ImportDeclaration;
};
