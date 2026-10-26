# Last Row setup

The site uses Firebase Authentication and Cloud Firestore for accounts and content. Images and videos are uploaded directly to Cloudinary before the corresponding Firestore record is created or updated. Firebase Storage is not required for new uploads.

## Configure Cloudinary uploads

1. Create a Cloudinary account and choose its free plan. The free plan has usage limits; check the current limits in your Cloudinary dashboard and avoid uploading media you do not need.
2. In **Settings → Upload → Upload presets**, create an unsigned upload preset. Restrict allowed formats to the image and video types the site needs, set a maximum file size of 50 MB, and use a dedicated folder such as `lastrow`.
3. Copy the Cloud name from the Cloudinary dashboard and the preset name into `cloudinary-config.js`:
   ```js
   export const cloudinaryConfig = {
     cloudName: 'YOUR_CLOUD_NAME',
     uploadPreset: 'YOUR_UNSIGNED_UPLOAD_PRESET'
   };
   ```
   The cloud name and unsigned preset are public client configuration, not secret credentials. Never put a Cloudinary API secret in this website.
4. The upload preset is publicly usable by design. Restrict formats, size, transformations, and other preset options in Cloudinary to reduce abuse and unexpected usage.

The admin portal uploads selected media first and only writes to Firestore after Cloudinary returns a secure URL. If the upload fails, no content record is created. If Cloudinary succeeds but Firestore rejects the save, the uploaded file may remain unused in Cloudinary; the portal reports this so it can be removed from the Cloudinary dashboard.

Deleting a post or crew profile removes its Firestore record, not the Cloudinary asset. Unsigned browser uploads cannot securely delete Cloudinary assets without a server-side signing service, so remove unwanted files from the Cloudinary dashboard. Older records that still contain Firebase Storage paths may likewise need manual cleanup.

## Firebase setup and deployment

1. In Firebase Console for project `lastrow-8e1d2`, enable **Authentication → Email/Password** and create a Firestore database.
2. Install Node.js and the Firebase CLI if they are not already installed:
   ```powershell
   npm install -g firebase-tools
   firebase login
   ```
3. Open PowerShell in this website folder and deploy the Firestore rules:
   ```powershell
   firebase deploy --only firestore:rules
   ```
4. To grant the first admin, open **Firestore Database → Data**. Create or open the `adminRequests` collection, then create a document whose ID is that account's Firebase Authentication UID. Add fields: `uid` (string, same UID), `email` (string), `approved` (boolean `true`), and `requestedAt` (timestamp). If the account has already requested access, open its existing document and change `approved` from `false` to `true`.
5. Sign in to the admin page with that account and refresh the page. The approved document is the admin role. Other people can create an account or sign in, then request approval from an existing admin.
6. Host the site over HTTP(S), not by opening HTML files with `file://`.

Firestore permits public reads of published content and restricts writes to approved admins. The store is a catalog; checkout and payment processing are not included.

## Managing the crew page

After an admin is signed in, open **The people behind Last Row** in the admin studio. Add each person's name, role/nickname, short bio, display order, and optional photo. Use **Edit** or **Remove** under **Published items → Crew** to maintain profiles. The public Crew page updates live from Firestore.
