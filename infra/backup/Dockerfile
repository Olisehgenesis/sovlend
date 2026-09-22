FROM postgres:17-alpine
RUN apk add --no-cache rclone tzdata
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
COPY crontab /etc/crontabs/root
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENV TZ=Africa/Kampala
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
