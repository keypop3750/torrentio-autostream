import { MochOptions } from '../moch/moch.js';
import { Providers } from './filter.js';
import { showDebridCatalog } from '../moch/options.js';
import { getManifestOverride } from './configuration.js';
import { Type } from './types.js';

const DefaultProviders = Providers.options.map(provider => provider.key);
const MochProviders = Object.values(MochOptions);

export function manifest(config = {}) {
  const overrideManifest = getManifestOverride(config);
  const baseManifest = {
    id: 'com.stremio.torrentio.addon',
    version: '2.0.2', // changed
    name: getName(overrideManifest, config), // will default to "AutoStream"
    description: getDescription(config),     // simplified static description
    catalogs: getCatalogs(config),           // now returns []
    resources: getResources(config),         // only stream
    types: [Type.MOVIE, Type.SERIES],        // limited types
    background: `${config.host}/images/background_v1.jpg`,
    logo: '`${config.host}/images/logo.png', // changed
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    // added
    stremioAddonsConfig: {
      issuer: 'https://stremio-addons.net',
      signature:
        'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..KPt7fOiOCod52ZjlFWg52A.dt7eIyal-1oAkU4cOG5c6YPsWn70Ds6AXqY1FJX3Ikqzzeu1gzgj2_xO4e4zh7gsXEyjhoAJ-L9Pg6UI57XD6FWjzpRcvV0v-6WuKmfZO_hDcDIrtVQnFf0nK2dnO7-n.v25_jaY5E-4yH_cxyTKfsA'
    }
  };
  return Object.assign(baseManifest, overrideManifest);
}

export function dummyManifest() {
  const manifestDefault = manifest();
  manifestDefault.catalogs = [];          // no catalogs
  manifestDefault.resources = ['stream']; // only stream
  return manifestDefault;
}

function getName(manifest, config) {
  // default rootName changed from 'Torrentio' to 'AutoStream'
  const rootName = manifest?.name || 'AutoStream';
  const mochSuffix = MochProviders
      .filter(moch => config[moch.key])
      .map(moch => moch.shortName)
      .join('/');
  return [rootName, mochSuffix].filter(v => v).join(' ');
}

function getDescription(config) {
  // simplified static description per request
  return 'AutoStream is a fork of Torrentio that picks the single best stream for each title, balancing quality with seeders. Debrid can be enabled via the Configure tab.';
}

function getCatalogs(config) {
  // no catalogs advertised
  return [];
}

function getResources(config) {
  const streamResource = {
    name: 'stream',
    types: [Type.MOVIE, Type.SERIES],
    idPrefixes: ['tt', 'kitsu']
  };
  // only stream resource
  return [streamResource];
}
