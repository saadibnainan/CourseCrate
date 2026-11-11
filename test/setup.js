// Node lacks DOMParser; linkedom stands in for Firefox's in tests.
import { DOMParser } from 'linkedom';
globalThis.DOMParser = DOMParser;
