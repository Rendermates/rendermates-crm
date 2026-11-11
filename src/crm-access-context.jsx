import { createContext, useContext } from 'react';
export const CrmAccessContext = createContext(null);
export const useCrmAccess = () => useContext(CrmAccessContext);
