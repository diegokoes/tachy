# An Azure VM

Under consideration, not decided (DEPLOYMENT-ARCHITECTURE.md §15.1). Nothing
on this page has been run on Azure. The `az` commands and the disk steps are
from Microsoft's reference; the rest was run in a local Debian 13 VM with
`host_profile: server`, on 4 and on 8 cores.

## What it needs

| Need                                              | Why                                                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| A VM, not Container Apps, App Service or ACI      | the sandbox launcher holds the Docker socket and starts a gVisor container per turn (§5.17)                                                     |
| x86_64, Debian 13, 4 vCPU and 16 GiB or more      | the overlay's memory limits sum to 13.72 GiB (§4.3). On 4 vCPU the installer lowers the embedder's CPU limit to 4; 8 vCPU runs the defaults     |
| No nested virtualization                          | gVisor's default platform, systrap, needs none ([gVisor](https://gvisor.dev/docs/architecture_guide/platforms/))                                |
| A data disk mounted at `/srv`                     | Docker's data, containerd's images, the backups and the status files live there                                                                 |
| A fixed outbound address                          | the helpdesk refuses addresses it does not know, so its admin has to allow this one. A new virtual network has no default outbound access       |
| Inbound 443 and 80 for the users, 22 for admins   | in the network security group and in `host.yml`: the host's firewall holds the same lists                                                       |
| A DNS name and a certificate                      | public name: Let's Encrypt through Caddy (`tls: acme`), which needs 80 and 443 open to the internet. Private name: files from IT (`tls: files`) |
| An Entra app registration                         | redirect address `https://<name>/auth/callback`; issuer `https://login.microsoftonline.com/<tenant>/v2.0`, a client id and a client secret      |
| A decision that company data may leave the office | §1 keeps backups off cloud storage and §15.1 lists this as open                                                                                 |

Outbound, all on 443: `api.anthropic.com`, `ghcr.io`, `github.com`,
`dev.azure.com`, the Freshdesk host, `download.docker.com`, `deb.debian.org`,
`storage.googleapis.com` (gVisor's release), `login.microsoftonline.com`, the
Teams webhook and healthchecks.io.

Not needed there: LUKS and TPM2 (the platform encrypts the disk), and the
battery, lid and mDNS settings, which `host_profile: server` leaves out.

## Create it

Reached from the internet, with single sign-on. The VM's own static address
is then its outbound address too.

```sh
az group create --name tachy --location <region>
az network nsg create --resource-group tachy --name tachy-nsg
az network nsg rule create --resource-group tachy --nsg-name tachy-nsg \
  --name site --priority 100 --direction Inbound --access Allow --protocol Tcp \
  --destination-port-ranges 80 443 --source-address-prefixes <who may reach the site>
az network nsg rule create --resource-group tachy --nsg-name tachy-nsg \
  --name ssh --priority 110 --direction Inbound --access Allow --protocol Tcp \
  --destination-port-ranges 22 --source-address-prefixes <where admins connect from>
az vm create --resource-group tachy --name tachy \
  --image Debian:debian-13:13-gen2:latest --size Standard_D4s_v5 \
  --admin-username <admin> --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg tachy-nsg --public-ip-sku Standard --public-ip-address-allocation static \
  --os-disk-size-gb 64 --data-disk-sizes-gb 128
```

`az vm image list --publisher Debian --offer debian-13 --all -o table` lists
the image versions. Let's Encrypt needs 80 and 443 open to every address, so
with `tls: acme` the `site` rule's source is `Internet`.

Reached only over the company network: leave the public address out
(`--public-ip-address ""`), and give the subnet a NAT gateway with a static
address for outbound, which is the address the helpdesk allows
([NAT gateway](https://learn.microsoft.com/en-us/azure/nat-gateway/nat-overview)).

## The data disk

On the VM, once, before the install
([Microsoft's steps](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/add-disk)):

```sh
sudo parted /dev/disk/azure/scsi1/lun0 --script mklabel gpt mkpart primary ext4 0% 100%
sudo mkfs.ext4 /dev/disk/azure/scsi1/lun0-part1
echo "UUID=$(sudo blkid -s UUID -o value /dev/disk/azure/scsi1/lun0-part1) /srv ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
sudo mount /srv
```

## Install

Over SSH, as the admin login, from an address inside the networks given for
SSH: the installer refuses a firewall that would cut its own session off.

```sh
curl -fsSL https://raw.githubusercontent.com/diegokoes/tachy/main/deploy/install.sh | sudo bash
```

- machine: `server`;
- name: the DNS name;
- who may reach the site: the users' ranges, or `any`;
- who may reach SSH: the admins' ranges as the VM sees them, which over a
  public address are public addresses, not the subnet;
- certificate: `acme` with a mailbox, or `files`;
- single sign-on: the issuer, the client id, and the secret at its hidden
  prompt.

[first-install.md](first-install.md) has the rest: the wizard, the admin kit,
what `tachy-install status` lists.

**With nobody at it.** Custom data can write `/etc/tachy/host.yml` and run
`install.sh --unattended`, but it is no place for the client secret: Microsoft
says not to store secrets in custom data
([custom data](https://learn.microsoft.com/en-us/azure/virtual-machines/custom-data)).
Install over SSH, or leave single sign-on out of `host.yml` and add the
`OIDC_*` lines to `/opt/tachy/.env` afterwards.

## What differs from the laptop

- `tachy-watch` skips its power and NVMe checks where the hardware is absent.
- Backups still stay on the VM's disk until a downloader pulls them over SFTP
  ([backups-and-restore.md](backups-and-restore.md)): the downloaders' ranges
  go into the `ssh` rule and into `backup_downloaders`.
- The host sizing in `/opt/tachy/.env` is the laptop's 16 GB budget; a larger
  VM raises it from the `Host sizing` block of `.env.example`.

## Not built

Managed Postgres, backups pushed to Blob Storage, and a template that creates
the VM. Azure Database for PostgreSQL has `vector`, `pg_trgm` and `pgcrypto`
behind its extension allowlist
([extensions](https://learn.microsoft.com/en-us/azure/postgresql/extensions/how-to-allow-extensions));
on this side the schema is applied as a superuser, and the backup, the
restore test and the deploy all run inside the Postgres container.
