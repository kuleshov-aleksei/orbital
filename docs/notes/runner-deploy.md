# github runners recreation

## x86 build machine

``` bash
systemctl stop actions.runner.kuleshov-aleksei-orbital.node-04.service
./svc.sh uninstall
usermod -s /bin/bash gh-action-runner-user
su gh-action-runner-user
```

``` bash
./config.sh remove --token REPLACE_ME
./config.sh --url https://github.com/kuleshov-aleksei/orbital --token REPLACE_ME
exit
```

``` bash
usermod -s /usr/sbin/nologin gh-action-runner-user
./svc.sh install
systemctl enable actions.runner.kuleshov-aleksei-orbital.node-04.service
systemctl start actions.runner.kuleshov-aleksei-orbital.node-04.service
```

## arm host machine

``` bash
systemctl stop actions.runner.kuleshov-aleksei-orbital.node-07.service
./svc.sh uninstall
usermod -s /bin/bash gh-actions-runner
su gh-actions-runner
```

``` bash
./config.sh remove --token REPLACE_ME
./config.sh --url https://github.com/kuleshov-aleksei/orbital --token REPLACE_ME
exit
```

``` bash
usermod -s /usr/sbin/nologin gh-actions-runner
./svc.sh install
systemctl enable actions.runner.kuleshov-aleksei-orbital.node-07.service
systemctl start actions.runner.kuleshov-aleksei-orbital.node-07.service
```
