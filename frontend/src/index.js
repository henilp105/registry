import React from "react";
import ReactDOM from "react-dom/client";

// --- Stylesheet load order. This is the only place it is expressed. -------
//   1. tokens.css  - custom property definitions; must be first so every
//                    later rule can read them.
//   2. Bootstrap  - vendor layer. Imported here, once, for the whole app.
//   3. base.css   - element defaults + the Bootstrap bridge, so it must come
//                    *after* the vendor sheet it is overriding.
//   4. index.css  - the few remaining document-level rules.
// Anything imported by a page component (App.css, home.css, the page
// stylesheets) is pulled in by ./App below and therefore lands last, which is
// what lets a page opt out of the base layer.
import "./theme/tokens.css";
import "bootstrap/dist/css/bootstrap.min.css";
import "./theme/base.css";
import "./index.css";
import App from "./App";
import { CookiesProvider } from "react-cookie";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import rootReducer from "./store/reducers/rootReducer";
import { persistStore, persistReducer } from "redux-persist";
import storage from "redux-persist/lib/storage";
import { PersistGate } from "redux-persist/integration/react";
import { createTransform, REGISTER } from "redux-persist";

const authTransform = createTransform(
  // Transform state on its way to being serialized and stored
  (inboundState, key) => {
    return {
      isAuthenticated: inboundState.isAuthenticated,
      username: inboundState.username,
      accessToken: inboundState.accessToken,
      refreshToken: inboundState.refreshToken,
    };
  },
  // Transform state on its way back from storage to be rehydrated
  (outboundState, key) => {
    return {
      ...outboundState,
    };
  },
  // Specify the key for the persistable state, in this case it is 'auth'
  { whitelist: ["auth"] }
);

const persistConfig = {
  key: "root",
  storage,
  transforms: [authTransform],
  whitelist: ["auth"],
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

const root = ReactDOM.createRoot(document.getElementById("root"));
const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoreActions: [REGISTER],
      },
    }),
});

const persistor = persistStore(store);

root.render(
  <Provider store={store}>
    <PersistGate persistor={persistor}>
      <CookiesProvider>
        <App />
      </CookiesProvider>
    </PersistGate>
  </Provider>
  // </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();
