export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set([]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.DuGtGmBc.js",app:"_app/immutable/entry/app.XvnN-yGv.js",imports:["_app/immutable/entry/start.DuGtGmBc.js","_app/immutable/chunks/DLw_56rH.js","_app/immutable/chunks/BMNRicTd.js","_app/immutable/entry/app.XvnN-yGv.js","_app/immutable/chunks/BMNRicTd.js","_app/immutable/chunks/BR73ucus.js","_app/immutable/chunks/CY63BMgb.js","_app/immutable/chunks/BKQDtKw3.js","_app/immutable/chunks/C6jOTLj7.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
