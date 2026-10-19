# Last Row Firebase setup

The site uses Firebase Authentication, Cloud Firestore, and Cloud Storage. The Firebase web app settings are in `firebase-config.js`; they are public client settings, not admin credentials.

## One-time deployment

1. In Firebase Console for project `lastrow-8e1d2`, enable **Authentication → Email/Password**, create a Firestore database, and enable Storage.
2. Install Node.js and the Firebase CLI if they are not already installed:
   ```powershell
   npm install -g firebase-tools
   firebase login
   ```
3. Open PowerShell in this website folder and deploy the database and storage rules:
   ```powershell
   firebase deploy --only firestore:rules,storage
   ```
   The Storage rules check the same `adminRequests/{uid}.approved` Firestore record as the portal. Firebase may prompt you to enable the required cross-service permissions between Cloud Storage and Firestore; approve that prompt for uploads and deletes to use the portal's admin approvals.
4. To grant the first admin, open **Firestore Database → Data**. Create or open the `adminRequests` collection, then create a document whose ID is that account's Firebase Authentication UID. Add fields: `uid` (string, same UID), `email` (string), `approved` (boolean `true`), and `requestedAt` (timestamp). If the account has already requested access, open its existing document and change `approved` from `false` to `true`.
5. Sign in to the admin page with that account and refresh the page. The approved document is the admin role.
6. Other people can create an account or sign in with an existing Firebase Authentication account, then request access. An existing admin approves requests in **Pending approvals**. The user should refresh the portal after approval.
7. Host the site over HTTP(S), not by opening HTML files with `file://`.

An approved `adminRequests/{uid}` document is the role record. Website users can create only their own requests with `approved: false`; they cannot approve themselves. Existing admins can approve requests in the portal, and a project owner can grant the first admin directly in Firebase Console. Approval grants full admin access (publishing, deleting content, editing crew profiles, and approving further accounts), so only approve people you trust.

Firestore and Storage rules permit public reads of published content and restrict writes/uploads to approved admins. Storage checks the approved `adminRequests/{uid}` record server-side; it does not rely on client-provided state or an Authentication custom claim. Admins can manage crew profiles, including photos, from the portal. Uploaded media is limited to 50 MB. The store is a catalog; checkout and payment processing are not included.

## Managing the crew page

After an admin is signed in, open **The people behind Last Row** in the admin studio. Add each person's name, role/nickname, short bio, display order, and optional photo. Use **Edit** or **Remove** under **Published items → Crew** to maintain profiles. The public Crew page updates live from Firestore.
