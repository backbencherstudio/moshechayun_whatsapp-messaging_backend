import { SojebStorage } from '../lib/Disk/SojebStorage';
import appConfig from '../../config/app.config';

export class FileUrlHelper {

    static addAvatarUrl(item: any) {
        if (!item) return item;
        if (item.avatar) {
            item.avatarUrl = SojebStorage.url(appConfig().storageUrl.avatar + item.avatar);
        }
        return item;
    }

    static generateRandomFileName(originalName: string): string {
        const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
        return `${randomName}-${originalName}`;
    }
}

