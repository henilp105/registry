import authReducer from "./authReducer";
import accountReducer from "./accountReducer";
import dashboardReducer from "./dashboardReducer";
import packageReducer from "./packageReducer";
import userReducer from "./userReducer";
import searchReducer from "./searchReducer";
import namespaceReducer from "./namespaceReducer";
import resetPasswordReducer from "./resetPasswordReducer";
import createNamespaceReducer from "./createNamespaceReducer";
import archivesReducer from "./archivesReducer";
import adminReducer from "./adminReducer";
import { combineReducers } from "redux";
import addRemoveMaintainerReducer from "./addRemoveMaintainerReducer";
import generateNamespaceTokenReducer from "./generateNamespaceTokenReducer";
import generatePackageTokenReducer from "./generatePackageTokenReducer";
import addRemoveNamespaceMaintainerReducer from "./namespaceMaintainersReducer";
import addRemoveNamespaceAdminReducer from "./namespaceAdminReducer";
import verifyEmailReducer from "./verifyEmailReducer";
import userListReducer from "./userListReducer";
import reportPackageReducer from "./reportPackageReducer";
import viewMalicousReportsReducer from "./viewMalicousReportsReducer";
import ratePackageReducer from "./ratePackageReducer";

/**
 * The slice map, named rather than inlined.
 *
 * `combineReducers` does not expose the reducers it was given, and the reset
 * below needs each slice's own reducer to read its initial state from. Keeping
 * the map as a value is what makes that possible without re-deriving it.
 */
const slices = {
  auth: authReducer,
  dashboard: dashboardReducer,
  account: accountReducer,
  user: userReducer,
  search: searchReducer,
  package: packageReducer,
  namespace: namespaceReducer,
  resetpassword: resetPasswordReducer,
  addRemoveMaintainer: addRemoveMaintainerReducer,
  generateNamespaceToken: generateNamespaceTokenReducer,
  generatePackageToken: generatePackageTokenReducer,
  admin: adminReducer,
  createNamespace: createNamespaceReducer,
  addRemoveNamespaceMaintainer: addRemoveNamespaceMaintainerReducer,
  addRemoveNamespaceAdmin: addRemoveNamespaceAdminReducer,
  verifyEmail: verifyEmailReducer,
  userList: userListReducer,
  archives: archivesReducer,
  reportPackage: reportPackageReducer,
  malicousReport: viewMalicousReportsReducer,
  ratePackage: ratePackageReducer,
};

const combined = combineReducers(slices);

/**
 * Wipe every session-scoped slice when the session ends.
 *
 * Defect D97: only `auth` was cleared on logout. Every other slice survived in
 * memory, and `logout()` navigates without a page reload -- so signing in as a
 * different account in the same tab left the previous account's data in the
 * store. `dashboardReducer` has no `LOGOUT_SUCCESS` case and `dashboard.js`
 * fetches only `if (!packages)`, so user B reached `/manage/projects` and was
 * shown user A's packages, namespaces, role chips and descriptions under a
 * greeting addressed to B.
 *
 * This is a cross-account disclosure, not a cosmetic one, and it is the kind
 * that survives a fix to any single page: the bug was the *absence* of a reset,
 * which no page-level `if` can be trusted to compensate for.
 *
 * Two details that matter:
 *
 *   - `search` is deliberately preserved. It holds only the query and sort the
 *     visitor typed, which is not account data, and wiping it would lose their
 *     search on every sign-in.
 *   - `archives` is preserved for the same reason: it is public registry content
 *     cached from an unauthenticated endpoint.
 *
 * Everything else is either account data (`dashboard`, `account`, `admin`,
 * `userList`), a resource fetched under somebody's identity (`package`,
 * `namespace`, `user`), or transient form/dialog state whose emptiness after a
 * sign-out is correct.
 */
const PRESERVED_ON_LOGOUT = new Set(["auth", "search", "archives"]);

const rootReducer = (state, action) => {
  const next = combined(state, action);

  // Matched on the action *type name* rather than an import, so this file does
  // not have to reach into authActions.js -- which would make the reducer graph
  // cyclic, since authActions imports from store/utils.
  if (action?.type === "LOGOUT_SUCCESS" && state) {
    const reset = {};
    for (const [key, reducer] of Object.entries(slices)) {
      reset[key] = PRESERVED_ON_LOGOUT.has(key)
        ? next[key]
        // Redux's documented way to read a slice's own initial state: call its
        // reducer with `undefined` state and an unrecognised action. Deriving it
        // from the reducer is the only approach that cannot drift from it.
        : reducer(undefined, { type: "@@session/reset" });
    }
    return reset;
  }

  return next;
};

export default rootReducer;
