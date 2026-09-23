// Desktop project membership is independent of a thread's working directory.
export function desktopProjects(saved, threads) {
  const order = saved['project-order'] || [], assignments = saved['thread-project-assignments'] || {};
  const projectless = new Set(saved['projectless-thread-ids'] || []);
  const projects = Object.values(saved['local-projects'] || {}).filter(project => !project.id.startsWith('g-p-')).map(project => ({
    id: project.id, name: project.name, roots: project.rootPaths || [],
    threadIds: saved['sidebar-project-thread-orders']?.[project.id]?.threadIds || [],
  }));
  const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
  projects.sort((a, b) => rank(a.id) - rank(b.id));
  const nativeIds = Object.assign({}, ...Object.values(saved['app-server-project-id-by-legacy-project-id-by-host'] || {}));
  for (const thread of threads) {
    const assignment = assignments[thread.id];
    const project = assignment
      ? projects.find(project => assignment.projectKind === 'local' && project.id === assignment.projectId)
      : projectless.has(thread.id) ? null : (thread.projectId && projects.find(project => project.id === thread.projectId || nativeIds[project.id] === thread.projectId))
        || projects.find(project => project.roots.includes(thread.cwd));
    Object.assign(thread, {projectId: project?.id || null, projectName: project?.name || null, projectPath: project?.roots[0] || null, projectless: !project});
  }
  return projects;
}
