const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredApiBaseUrl || 'http://localhost:5001/api').replace(/\/+$/, '');

export function getApiErrorMessage(data) {
  if (data?.error === 'Internal Server Error' && data.message) return data.message;
  return data?.error || data?.message || 'API Request Failed';
}

export const fetchWithAuth = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const config = {
    ...options,
    headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
  
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && token) {
    localStorage.removeItem('token');
    localStorage.removeItem('clickngo_user');
    window.location.href = '/login?session=expired';
  }

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data));
  }

  return { response, data };
};
