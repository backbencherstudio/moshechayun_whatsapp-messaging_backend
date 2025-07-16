import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
// If you use authentication, import your guard(s):
// import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  // @UseGuards(JwtAuthGuard) // Uncomment if you want to protect this route
  @Get('stats')
  async getStats(@Request() req) {
    const clientId = req.user?.userId || req.query.clientId || req.params.clientId;
    return this.dashboardService.getStats(clientId);
  }

  @Get('global-stats')
  async getGlobalStats() {
    return this.dashboardService.getGlobalStats();
  }

  @Get('clients/top')
  async getTopClients() {
    return this.dashboardService.getTopClients();
  }

  @Get('errors/recent')
  async getRecentErrors() {
    return this.dashboardService.getRecentErrors();
  }

  @Get('message-trends')
  async getMessageTrends(@Request() req) {
    const clientId = req.user?.userId || req.query.clientId || req.params.clientId;
    const days = req.query.days ? parseInt(req.query.days, 10) : 7;
    return this.dashboardService.getMessageTrends(clientId, days);
  }

  @Get('credit-history')
  async getCreditHistory(@Request() req) {
    const clientId = req.user?.userId || req.query.clientId || req.params.clientId;
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    return this.dashboardService.getCreditHistory(clientId, days);
  }

  @Get('message-status-ratio')
  async getMessageStatusRatio(@Request() req) {
    const clientId = req.user?.userId || req.query.clientId || req.params.clientId;
    return this.dashboardService.getMessageStatusRatio(clientId);
  }
}
