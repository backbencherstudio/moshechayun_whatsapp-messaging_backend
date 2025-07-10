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
}