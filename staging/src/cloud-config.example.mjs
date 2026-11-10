// Copy to cloud-config.mjs and replace ONLY public project URL and public publishable key.
// Do not put login emails, passwords, session tokens, or service_role keys here.
// Do not deploy this staging demo in place of the existing scorebook.
export const cloudConfig = {
  projectUrl: 'https://YOUR-PERSONAL-PROJECT.supabase.co',
  publishableKey: 'sb_publishable_REPLACE_WITH_PROJECT_PUBLIC_KEY'
};