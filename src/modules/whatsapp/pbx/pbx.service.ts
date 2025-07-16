import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import appConfig from 'src/config/app.config';

@Injectable()
export class PBXService {
    private readonly logger = new Logger(PBXService.name);

    async sendAutoResponseCall(phoneNumber: string, message: string) {
        try {
            // Replace with your PBX API endpoint and payload
            await axios.post(`${appConfig().app.url}/auto-response`, {
                to: phoneNumber,
                message,
            });
            this.logger.log(`PBX auto-response triggered for ${phoneNumber}`);
        } catch (error) {
            this.logger.error(`Failed to trigger PBX auto-response: ${error.message}`);
        }
    }
}
