import { createContext, useContext, useMemo, useState, useEffect, useCallback } from 'react';
import api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const STORAGE_KEY = 'robot-pms:projectId';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const { token } = useAuth();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectIdState] = useState(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  });
  const [loading, setLoading] = useState(false);

  const refreshProjects = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data } = await api.get('/api/projects');
      setProjects(data);
      setProjectIdState((current) => {
        if (current && data.some((p) => p.id === current)) return current;
        if (data.length) {
          const first = data[0].id;
          localStorage.setItem(STORAGE_KEY, String(first));
          return first;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
      });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) refreshProjects();
    else {
      setProjects([]);
      setProjectIdState(null);
    }
  }, [token, refreshProjects]);

  const setProjectId = useCallback((id) => {
    setProjectIdState(id);
    if (id) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const current = useMemo(
    () => projects.find((p) => p.id === projectId) || null,
    [projects, projectId],
  );

  const value = useMemo(
    () => ({
      projects,
      projectId,
      currentProject: current,
      setProjectId,
      refreshProjects,
      loading,
    }),
    [projects, projectId, current, setProjectId, refreshProjects, loading],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}
