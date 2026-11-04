const express = require('express');
const path = require('node:path');
const { createEventRepository } = require('./repositories/event.repository');
const { createMySqlRegistrationRepository } = require('./repositories/registration.repository');
const { createAuthRouter } = require('./routes/auth.routes');
const { createMyEventsRouter } = require('./routes/my-events.routes');
const { createRegistrationRouter } = require('./routes/registration.routes');
const { createMySqlSubmissionRepository } = require('./repositories/submission.repository');
const { createSubmissionRouter } = require('./routes/submission.routes');
const { createMySqlTeamRepository } = require('./repositories/team.repository');
const { createTeamRouter } = require('./routes/team.routes');
const { createMySqlEventManagementRepository } = require('./repositories/event-management.repository');
const { createOrganizerEventRouter } = require('./routes/organizer-event.routes');
const { createMySqlJudgingRepository } = require('./repositories/judging.repository');
const { createJudgingRouter } = require('./routes/judging.routes');
const { createResultsRouter } = require('./routes/results.routes');
const { createMySqlNotificationRepository } = require('./repositories/notification.repository');
const { createNotificationRouter } = require('./routes/notification.routes');
const { createMySqlAdminRepository } = require('./repositories/admin.repository');
const { createAdminRouter } = require('./routes/admin.routes');
const { createWebPushService } = require('./services/web-push.service');

const app = express();
const clientDirectory = path.join(__dirname, '..', 'client');
const eventRepository = createEventRepository();
const auth = createAuthRouter();
app.locals.eventDataSource = eventRepository.source;
app.locals.googleSignInEnabled = auth.enabled;
const asyncRoute = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

app.disable('x-powered-by');
app.use(express.json());
app.use(auth.middleware);

app.get(
  '/api/health',
  asyncRoute(async (_request, response) => {
    await eventRepository.checkHealth();
    response.json({
      status: 'ok',
      dataSource: eventRepository.source,
      googleSignInEnabled: auth.enabled,
      localAuthEnabled: auth.localAuthEnabled,
    });
  }),
);

app.get(
  '/api/events',
  asyncRoute(async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    const category = typeof request.query.category === 'string' ? request.query.category : '';
    response.json(await eventRepository.list({ query, category }));
  }),
);

app.get(
  '/api/events/:eventId',
  asyncRoute(async (request, response) => {
    const event = await eventRepository.findById(request.params.eventId);

    if (!event) {
      response.status(404).json({ error: 'Event not found' });
      return;
    }

    response.json({ event });
  }),
);

const notificationRepository = auth.pool
  ? createMySqlNotificationRepository(auth.pool)
  : null;
const webPushService = auth.pool
  ? createWebPushService({ repository: notificationRepository })
  : { enabled: false, publicKey: null, async sendToUser() {} };
const registrationRepository = auth.pool
  ? createMySqlRegistrationRepository(auth.pool, { sendPush: webPushService.sendToUser })
  : null;
const adminRepository = auth.pool ? createMySqlAdminRepository(auth.pool) : null;
app.use(
  '/api/notifications',
  createNotificationRouter({
    repository: notificationRepository,
    pushService: webPushService,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
app.use(
  '/api/admin',
  createAdminRouter({
    repository: adminRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
app.use(
  '/api/events',
  createRegistrationRouter({
    repository: registrationRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
app.use(
  '/api/my-events',
  createMyEventsRouter({
    repository: registrationRepository,
    requireAuthenticated: auth.requireAuthenticated,
  }),
);
const teamRepository = auth.pool ? createMySqlTeamRepository(auth.pool) : null;
app.use(
  '/api/teams',
  createTeamRouter({
    repository: teamRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
const submissionRepository = auth.pool ? createMySqlSubmissionRepository(auth.pool) : null;
app.use(
  '/api/submissions',
  createSubmissionRouter({
    repository: submissionRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
const eventManagementRepository = auth.pool
  ? createMySqlEventManagementRepository(auth.pool)
  : null;
const judgingRepository = auth.pool
  ? createMySqlJudgingRepository(auth.pool, { sendPush: webPushService.sendToUser })
  : null;
app.use(
  '/api/organizer',
  createOrganizerEventRouter({
    repository: eventManagementRepository,
    judgingRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
app.use(
  '/api/judging',
  createJudgingRouter({
    repository: judgingRepository,
    requireAuthenticated: auth.requireAuthenticated,
    requireSameOrigin: auth.requireSameOrigin,
  }),
);
app.use('/api/results', createResultsRouter(judgingRepository));

app.use('/api/auth', auth.router);
app.use(express.static(clientDirectory));

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found' });
});

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) {
    console.error('API request failed:', error);
  }
  response.status(status).json({
    error: status < 500 ? error.message : 'Internal server error',
  });
});

module.exports = app;
