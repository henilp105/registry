import authReducer from "./authReducer";
import accountReducer from "./accountReducer";
import dashboardReducer from "./dashboardReducer";
import packageReducer from "./packageReducer";
import userReducer from "./userReducer";
import searchReducer from "./searchReducer";
import namespaceReducer from "./namespaceReducer";
import resetPasswordReducer from "./resetPasswordReducer";
import createNamespaceReducer from "./createNamespaceReducer";
import adminReducer from "./adminReducer";
import { combineReducers } from "redux";
import addRemoveMaintainerReducer from "./addRemoveMaintainerReducer";
import generateNamespaceTokenReducer from "./generateNamespaceTokenReducer";
import addRemoveNamespaceMaintainerReducer from "./namespaceMaintainersReducer";
import addRemoveNamespaceAdminReducer from "./namespaceAdminReducer";
import verifyEmailReducer from "./verifyEmailReducer";

const rootReducer = combineReducers({
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
  admin: adminReducer,
  createNamespace: createNamespaceReducer,
  addRemoveNamespaceMaintainer: addRemoveNamespaceMaintainerReducer,
  addRemoveNamespaceAdmin: addRemoveNamespaceAdminReducer,
  verifyEmail: verifyEmailReducer,
});

export default rootReducer;
