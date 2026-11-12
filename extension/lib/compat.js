// Firefox calls the WebExtension API `browser`; Chrome calls it `chrome`. In
// Manifest V3 both return promises, so one name is enough everywhere.
globalThis.browser ??= globalThis.chrome;
