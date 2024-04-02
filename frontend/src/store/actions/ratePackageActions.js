import axios from "axios";

export const RATE_PACKAGE_REQUEST = "RATE_PACKAGE_REQUEST";
export const RATE_PACKAGE_SUCCESS = "RATE_PACKAGE_SUCCESS";
export const RATE_PACKAGE_FAILURE = "RATE_PACKAGE_FAILURE";
export const RESET_ERROR_MESSAGE = "RESET_ERROR_MESSAGE";

export const ratePackage = (data, access_token) => async (dispatch) => {
  let formData = new FormData();
  formData.append("rating", data.rating);

  let packageName = data.package;
  let namespaceName = data.namespace;

  try {
    dispatch({
      type: RATE_PACKAGE_REQUEST,
    });

    const result = await axios({
      method: "post",
      url: `${process.env.REACT_APP_REGISTRY_API_URL}/ratings/${namespaceName}/${packageName}`,
      data: formData,
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    dispatch({
      type: RATE_PACKAGE_SUCCESS,
      payload: {
        message: result.data.message,
        statuscode: result.data.code,
      },
    });
  } catch (error) {
    dispatch({
      type: RATE_PACKAGE_FAILURE,
      payload: {
        message: error.response.data.message,
        statuscode: error.response.data.code,
      },
    });
  }
};

export const resetErrorMessage = () => (dispatch) => {
  dispatch({
    type: RESET_ERROR_MESSAGE,
  });
};
