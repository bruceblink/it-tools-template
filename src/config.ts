import { defineConfig } from 'figue';
import * as v from 'valibot';

export const { config } = defineConfig({
  app: {
    version: {
      doc: 'Application current version',
      schema: v.string(),
      default: '0.0.0',
      env: 'PACKAGE_VERSION',
    },
    authorUrl: {
      doc: 'Application author url',
      schema: v.string(),
      default: 'https://likanug.top',
      env: 'AUTHOR_URL',
    },
    sponsoringUrl: {
      doc: 'Application sponsoring url',
      schema: v.string(),
      default: 'https://buymeacoffee.com/bruceblink',
      env: 'SPONSORING_URL',
    },
    repositoryUrl: {
      doc: 'Application repository url',
      schema: v.string(),
      default: 'https://github.com/bruceblink/it-tools',
      env: 'REPOSITORY_URL',
    },
    lastCommitSha: {
      doc: 'Application last commit SHA version',
      schema: v.string(),
      default: '',
      env: 'VITE_VERCEL_GIT_COMMIT_SHA',
    },
    baseUrl: {
      doc: 'Application base url',
      schema: v.string(),
      default: '/',
      env: 'BASE_URL',
    },
    env: {
      doc: 'Application current env',
      schema: v.picklist(['production', 'development', 'preview', 'test']),
      default: 'development',
      env: 'VITE_VERCEL_ENV',
    },
  },
  plausible: {
    isTrackerEnabled: {
      doc: 'Is the tracker enabled',
      schema: v.boolean(),
      default: false,
      env: 'VITE_TRACKER_ENABLED',
    },
    domain: {
      doc: 'Plausible current domain',
      schema: v.string(),
      default: '',
      env: 'VITE_PLAUSIBLE_DOMAIN',
    },
    apiHost: {
      doc: 'Plausible remote api host',
      schema: v.string(),
      default: '',
      env: 'VITE_PLAUSIBLE_API_HOST',
    },
    trackLocalhost: {
      doc: 'Enable or disable localhost tracking by plausible',
      schema: v.boolean(),
      default: false,
    },
  },
  showBanner: {
    doc: 'Show the banner',
    schema: v.boolean(),
    default: false,
    env: 'VITE_SHOW_BANNER',
  },
  showSponsorBanner: {
    doc: 'Show the sponsor banner',
    schema: v.boolean(),
    default: false,
    env: 'VITE_SHOW_SPONSOR_BANNER',
  },
});
