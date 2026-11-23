import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedTypes = [
  'image/svg+xml',
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  // Analytics, supplier imports and TikTok Shop operations (src/plugins/kanjo-ops).
  'kanjo-ops': { enabled: true, resolve: './src/plugins/kanjo-ops' },
  'users-permissions': {
    config: {
      jwtManagement: 'refresh',
      sessions: {
        httpOnly: true,
      },
    },
  },
  upload: {
    config: {
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes,
      },
      sizeLimit: 25 * 1024 * 1024,
      // Product images go to Cloudflare R2 when it is configured (a separate
      // bucket from the website's own media); otherwise to public/uploads,
      // which is only appropriate for local development.
      ...(env('R2_BUCKET_NAME', '')
        ? {
            provider: 'aws-s3',
            providerOptions: {
              baseUrl: env('R2_PUBLIC_BASE_URL'),
              s3Options: {
                credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
                region: 'auto',
                endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
                // R2 has no ACLs; do not send one.
                params: { Bucket: env('R2_BUCKET_NAME'), ACL: undefined },
              },
            },
          }
        : {}),
    },
  },
});

export default config;
